"""
make_fixtures.py -- generates DICOM test fixtures + expected results for test.js

Run with the venv python:  venv/Scripts/python make_fixtures.py

Writes into ./fixtures/:
  fNN_*.dcm            fixture files
  fNN_*.gray8.bin      expected 8-bit display output (row-major, rows*cols bytes)
  expected.json        per-fixture expectations consumed by test.js

Fixtures f01-f20 are written with pydicom. Fixtures f21+ (codecs, colour,
multi-frame, VOI LUT, Presentation LUT, orientation tags) are written byte by
byte with struct and need only numpy + Pillow (+ OpenCV, whose bundled
libjpeg-turbo independently decodes the 8-bit lossless JPEG streams as a
cross-check of the encoder). Without pydicom the committed f01-f20 files are
kept, the expectations of the legacy fixtures whose behaviour changed
(f05/f06/f07/f16/f17) are recomputed from the committed files, and f21+ are
regenerated.
"""
import hashlib
import io
import json
import math
import os
import struct
import sys
import time
import warnings
import zlib

import numpy as np

try:
    import pydicom
    from pydicom.dataset import Dataset, FileMetaDataset
    from pydicom.dataelem import DataElement
    from pydicom.sequence import Sequence
    from pydicom.encaps import encapsulate
    from pydicom.uid import (
        ImplicitVRLittleEndian, ExplicitVRLittleEndian, ExplicitVRBigEndian,
        DeflatedExplicitVRLittleEndian, JPEGLosslessSV1, generate_uid,
    )
    from pydicom.pixels import apply_modality_lut, apply_windowing
    HAVE_PYDICOM = True
except ImportError:
    HAVE_PYDICOM = False

warnings.simplefilter("ignore")

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "fixtures")
os.makedirs(FIX, exist_ok=True)

ROWS, COLS = 96, 128  # non-square so row/column swaps are caught

CANARIES = [
    b"SHOULD^NOT^BE^READ",
    b"CANARY-ID-12345",
    b"19000101",
    b"CANARY INSTITUTION",
    b"CANARY^PHYSICIAN",
    b"PRIVATE CANARY LO",
    b"NESTED^CANARY",
    b"SEQ^CANARY",
    b"TRAILING PRIVATE CANARY",
]

expected = []


# ----------------------------------------------------------------------------
# Reference implementations of the decoder's display pipeline (the spec)
# ----------------------------------------------------------------------------

def nearest_rank_percentile(sorted_vals, p):
    n = len(sorted_vals)
    target = int(math.ceil(p / 100.0 * n))
    target = max(1, min(n, target))
    return int(sorted_vals[target - 1])


def auto_window(stored, slope, intercept, pad_mask=None, pct=(0.5, 99.5)):
    vals = stored if pad_mask is None else stored[~pad_mask]
    s = np.sort(vals.ravel())
    lo = nearest_rank_percentile(s, pct[0]) * slope + intercept
    hi = nearest_rank_percentile(s, pct[1]) * slope + intercept
    if lo > hi:
        lo, hi = hi, lo
    return (lo + hi) / 2.0, (hi - lo) + 1.0


def window_to_gray8(x, center, width, fn="LINEAR", invert=False):
    """PS3.3 C.11.2.1.2.1 LINEAR / C.11.2.1.3.2 LINEAR_EXACT mapped to 0..255,
    rounded half-to-even (like Uint8ClampedArray), inverted for MONOCHROME1."""
    x = x.astype(np.float64)
    if fn == "LINEAR_EXACT":
        lo = center - width / 2.0
        k = 255.0 / width
    else:
        lo = center - 0.5 - (width - 1) / 2.0
        k = None if width == 1 else 255.0 / (width - 1)
    if k is None:
        y = np.where(x > lo, 255.0, 0.0)
    else:
        y = np.clip((x - lo) * k, 0.0, 255.0)
    y = np.rint(y)
    if invert:
        y = 255.0 - y
    return y.astype(np.uint8)


def pydicom_gray8(ds, stored):
    """Cross-check path through pydicom's own apply_modality_lut/apply_windowing,
    scaled to 0..255 and inverted for MONOCHROME1. Returns None if no window tag."""
    if "WindowCenter" not in ds or "WindowWidth" not in ds:
        return None
    arr = apply_modality_lut(stored, ds)
    out = apply_windowing(arr, ds, index=0)
    # Recover pydicom's y_min / y_max (see apply_windowing source)
    bs = int(ds.BitsStored)
    if int(ds.PixelRepresentation) == 0:
        y_min, y_max = 0.0, float(2 ** bs - 1)
    else:
        y_min, y_max = float(-(2 ** (bs - 1))), float(2 ** (bs - 1) - 1)
    if "RescaleSlope" in ds and "RescaleIntercept" in ds:
        y_min = y_min * float(ds.RescaleSlope) + float(ds.RescaleIntercept)
        y_max = y_max * float(ds.RescaleSlope) + float(ds.RescaleIntercept)
    g = np.rint((out - y_min) / (y_max - y_min) * 255.0)
    if ds.PhotometricInterpretation == "MONOCHROME1":
        g = 255.0 - g
    return np.clip(g, 0, 255).astype(np.uint8)


# ----------------------------------------------------------------------------
# Synthetic image content
# ----------------------------------------------------------------------------

def gradient_image(rows, cols, vmax, rect_value, seed=1):
    """Diagonal gradient 0..vmax plus a bright rectangle plus a little noise."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:rows, 0:cols]
    g = (xx / (cols - 1) * 0.6 + yy / (rows - 1) * 0.4) * vmax
    g = g + rng.normal(0, vmax * 0.01, size=g.shape)
    img = np.clip(np.rint(g), 0, vmax).astype(np.int64)
    img[rows // 4: rows // 2, cols // 3: 2 * cols // 3] = rect_value
    return img


def base_dataset(ts, rows=ROWS, cols=COLS, modality="DX", sop_class="1.2.840.10008.5.1.4.1.1.1.1"):
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ts
    ds.file_meta.MediaStorageSOPClassUID = sop_class
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID = sop_class
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.Modality = modality
    ds.StudyDate = "20240101"
    ds.Rows = rows
    ds.Columns = cols
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    return ds


def save(ds, name, **kw):
    path = os.path.join(FIX, name)
    ds.save_as(path, enforce_file_format=True, **kw)
    return path


def write_gray(name, gray):
    p = os.path.join(FIX, name + ".gray8.bin")
    with open(p, "wb") as f:
        f.write(np.ascontiguousarray(gray, dtype=np.uint8).tobytes())
    return os.path.basename(p)


def find_all(data, needle):
    out = []
    start = 0
    while True:
        i = data.find(needle, start)
        if i < 0:
            return out
        out.append(i)
        start = i + 1


def canary_offsets(path):
    data = open(path, "rb").read()
    spans = []
    for c in CANARIES:
        for off in find_all(data, c):
            spans.append([off, len(c)])
    return spans


def add_case(**kw):
    expected.append(kw)


# ----------------------------------------------------------------------------
# 1. Implicit VR LE, 16-bit MONO2, PixelSpacing, multi-valued window
# ----------------------------------------------------------------------------
def fixture_01():
    name = "f01_implicit_mono2_16.dcm"
    img = gradient_image(ROWS, COLS, 4095, 3900)
    ds = base_dataset(ImplicitVRLittleEndian, modality="CR", sop_class="1.2.840.10008.5.1.4.1.1.1")
    ds.PixelSpacing = [0.15, 0.15]
    ds.WindowCenter = ["2048", "3000"]
    ds.WindowWidth = ["1024", "2000"]
    ds.PixelData = img.astype("<u2").tobytes()
    save(ds, name)
    stored = img.astype(np.int64)
    g1 = window_to_gray8(stored, 2048, 1024)
    ds2 = pydicom.dcmread(os.path.join(FIX, name))
    g2 = pydicom_gray8(ds2, ds2.pixel_array)
    assert np.abs(g1.astype(int) - g2.astype(int)).max() <= 1, "self-check f01"
    add_case(file=name, ok=True, reason=None, label="implicit VR LE 16-bit MONOCHROME2, PixelSpacing, multi-valued window",
             expect={"transferSyntaxUID": "1.2.840.10008.1.2", "modality": "CR", "photometric": "MONOCHROME2",
                     "rows": ROWS, "columns": COLS, "bitsAllocated": 16, "bitsStored": 16, "highBit": 15,
                     "pixelRepresentation": 0, "samplesPerPixel": 1, "numberOfFrames": None,
                     "pixelSpacingMm": {"row": 0.15, "col": 0.15, "source": "PixelSpacing"},
                     "rescale": {"slope": 1, "intercept": 0, "applied": False},
                     "window": {"center": 2048, "width": 1024, "source": "tag", "function": "LINEAR"},
                     "preamble": True},
             gray8=write_gray(name, g1), raw16=stored.ravel().tolist()[:64], raw16Type="Int32Array",
             noWarnings=True)


# ----------------------------------------------------------------------------
# 2. Explicit VR LE, 12 bits stored in 16, MONOCHROME1, ImagerPixelSpacing,
#    undefined-length sequence with nested sequence before PixelData
# ----------------------------------------------------------------------------
def fixture_02():
    name = "f02_explicit_mono1_12bit.dcm"
    img = gradient_image(ROWS, COLS, 4095, 4000, seed=2)
    rng = np.random.default_rng(22)
    garbage = rng.integers(0, 16, size=img.shape, dtype=np.int64) << 12  # bits 12..15 must be masked off
    raw = (img | garbage).astype("<u2")
    ds = base_dataset(ExplicitVRLittleEndian)
    ds.PhotometricInterpretation = "MONOCHROME1"
    ds.BitsStored = 12
    ds.HighBit = 11
    ds.ImagerPixelSpacing = [0.2, 0.25]
    ds.WindowCenter = "1500"
    ds.WindowWidth = "2500"
    # undefined-length sequence with nested undefined-length sequence
    item = Dataset()
    item.ReferencedSOPClassUID = "1.2.840.10008.5.1.4.1.1.1.1"
    item.ReferencedSOPInstanceUID = generate_uid()
    nested = Dataset()
    nested.CodeValue = "121311"
    nested.CodingSchemeDesignator = "DCM"
    nested.CodeMeaning = "Localizer"
    item.PurposeOfReferenceCodeSequence = Sequence([nested])
    item.is_undefined_length_sequence_item = True
    item["PurposeOfReferenceCodeSequence"].is_undefined_length = True
    nested.is_undefined_length_sequence_item = True
    ds.ReferencedImageSequence = Sequence([item])
    ds["ReferencedImageSequence"].is_undefined_length = True
    ds.PixelData = raw.tobytes()
    ds["PixelData"].VR = "OW"
    save(ds, name)
    # verify pydicom wrote undefined lengths
    data = open(os.path.join(FIX, name), "rb").read()
    assert data.count(b"\xfe\xff\xdd\xe0") >= 2, "expected two sequence delimiters"
    stored = img.astype(np.int64)
    g1 = window_to_gray8(stored, 1500, 2500, invert=True)
    ds2 = pydicom.dcmread(os.path.join(FIX, name))
    g2 = pydicom_gray8(ds2, (ds2.pixel_array.astype(np.int64) & 0x0FFF))
    assert np.abs(g1.astype(int) - g2.astype(int)).max() <= 1, "self-check f02"
    add_case(file=name, ok=True, reason=None, label="explicit VR LE 12/16-bit MONOCHROME1, ImagerPixelSpacing, undefined-length nested SQ",
             expect={"transferSyntaxUID": "1.2.840.10008.1.2.1", "modality": "DX", "photometric": "MONOCHROME1",
                     "rows": ROWS, "columns": COLS, "bitsAllocated": 16, "bitsStored": 12, "highBit": 11,
                     "pixelSpacingMm": {"row": 0.2, "col": 0.25, "source": "ImagerPixelSpacing"},
                     "window": {"center": 1500, "width": 2500, "source": "tag", "function": "LINEAR"}},
             gray8=write_gray(name, g1), raw16=stored.ravel().tolist()[:64], raw16Type="Int32Array", noWarnings=True)


# ----------------------------------------------------------------------------
# 3. 8-bit MONO2 explicit LE, no window, no spacing -> auto window
# ----------------------------------------------------------------------------
def fixture_03():
    name = "f03_explicit_mono2_8bit.dcm"
    img = gradient_image(ROWS, COLS, 255, 250, seed=3)
    # a few outliers so that percentile clipping matters
    img[0, 0:5] = 0
    img[-1, -5:] = 255
    ds = base_dataset(ExplicitVRLittleEndian, modality="CR", sop_class="1.2.840.10008.5.1.4.1.1.1")
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelData = img.astype(np.uint8).tobytes()
    ds["PixelData"].VR = "OB"
    save(ds, name)
    stored = img.astype(np.int64)
    c, w = auto_window(stored, 1, 0)
    g1 = window_to_gray8(stored, c, w)
    add_case(file=name, ok=True, reason=None, label="explicit VR LE 8-bit MONOCHROME2, no window, no spacing",
             expect={"bitsAllocated": 8, "bitsStored": 8, "highBit": 7, "rows": ROWS, "columns": COLS,
                     "pixelSpacingMm": {"row": None, "col": None, "source": None},
                     "window": {"center": c, "width": w, "source": "auto_percentile", "function": "LINEAR"}},
             gray8=write_gray(name, g1), raw16=stored.ravel().tolist()[:64], raw16Type="Int32Array", noWarnings=True)


# ----------------------------------------------------------------------------
# 4. 16-bit signed, RescaleIntercept -1024, PixelPaddingValue, no window
# ----------------------------------------------------------------------------
def fixture_04():
    name = "f04_signed_rescale_padding.dcm"
    img = gradient_image(ROWS, COLS, 3200, 3000, seed=4) - 200  # stored -200 .. 3000
    pad = np.zeros(img.shape, dtype=bool)
    pad[:8, :] = True
    pad[:, :6] = True
    img[pad] = -2000
    ds = base_dataset(ExplicitVRLittleEndian, modality="CT", sop_class="1.2.840.10008.5.1.4.1.1.2")
    ds.PixelRepresentation = 1
    ds.RescaleIntercept = "-1024"
    ds.RescaleSlope = "1"
    ds.add_new((0x0028, 0x0120), "SS", -2000)
    ds.PixelSpacing = [0.5, 0.5]
    ds.PixelData = img.astype("<i2").tobytes()
    ds["PixelData"].VR = "OW"
    save(ds, name)
    stored = img.astype(np.int64)
    c, w = auto_window(stored, 1, -1024, pad_mask=pad)
    g1 = window_to_gray8(stored - 1024, c, w)
    add_case(file=name, ok=True, reason=None, label="16-bit signed, RescaleIntercept -1024, PixelPaddingValue -2000, auto window",
             expect={"pixelRepresentation": 1, "modality": "CT",
                     "rescale": {"slope": 1, "intercept": -1024, "applied": True},
                     "window": {"center": c, "width": w, "source": "auto_percentile", "function": "LINEAR"},
                     "pixelPadding": {"value": -2000, "lo": -2000, "hi": -2000, "count": int(pad.sum()), "rangeLimit": None}},
             gray8=write_gray(name, g1), raw16=(stored - 1024).ravel().tolist()[:64], raw16Type="Int32Array", noWarnings=True)


# ----------------------------------------------------------------------------
# 5. JPEG Lossless transfer syntax, dummy encapsulated pixel data
# ----------------------------------------------------------------------------
def fixture_05():
    name = "f05_jpeg_lossless.dcm"
    ds = base_dataset(JPEGLosslessSV1, rows=512, cols=640, modality="DX")
    ds.PixelSpacing = [0.1, 0.1]
    ds.WindowCenter = "100"
    ds.WindowWidth = "200"
    ds.PixelData = encapsulate([b"\xff\xd8\xff\xc3" + bytes(range(256)) * 4])
    ds["PixelData"].VR = "OB"
    ds["PixelData"].is_undefined_length = True
    save(ds, name)
    add_case(**expect_f05())


def expect_f05():
    # The bitstream is dummy bytes (its SOF3 segment length is 0x0001), so the
    # lossless decoder must fail closed on it; real streams are f21+.
    return dict(file="f05_jpeg_lossless.dcm", ok=False, reason="jpeg_stream_invalid", label="JPEG Lossless SV1 with a corrupt (dummy) bitstream",
                expect={"transferSyntaxUID": "1.2.840.10008.1.2.4.70", "rows": 512, "columns": 640, "modality": "DX",
                        "pixelSpacingMm": {"row": 0.1, "col": 0.1, "source": "PixelSpacing"}, "gray8": None, "raw16": None})


# ----------------------------------------------------------------------------
# 6. NumberOfFrames 3
# ----------------------------------------------------------------------------
def fixture_06():
    name = "f06_multiframe.dcm"
    img = gradient_image(ROWS, COLS, 4095, 3000, seed=6)
    ds = base_dataset(ExplicitVRLittleEndian)
    ds.NumberOfFrames = "3"
    ds.PixelData = np.stack([img, img, img]).astype("<u2").tobytes()
    ds["PixelData"].VR = "OW"
    save(ds, name)
    add_case(**expect_f06())


def expect_f06():
    name = "f06_multiframe.dcm"
    raw = np.frombuffer(file_pixel_bytes(name), dtype="<u2").astype(np.int64)
    stored = raw[:ROWS * COLS].reshape(ROWS, COLS)  # frame 1
    c, w = auto_window(stored, 1, 0)
    return dict(file=name, ok=True, reason=None, label="NumberOfFrames 3 -> frame 1 decoded",
                expect={"numberOfFrames": 3, "frameDecoded": 1, "rows": ROWS, "columns": COLS, "pixelCodec": "native",
                        "window": {"center": c, "width": w, "source": "auto_percentile", "function": "LINEAR"}},
                gray8=write_gray(name, window_to_gray8(stored, c, w)), raw16=stored.ravel().tolist()[:64], raw16Type="Int32Array",
                warningsInclude=["multi_frame_first_frame_used"])


# ----------------------------------------------------------------------------
# 7. RGB samples per pixel 3
# ----------------------------------------------------------------------------
def fixture_07():
    name = "f07_rgb.dcm"
    ds = base_dataset(ExplicitVRLittleEndian, modality="OT", sop_class="1.2.840.10008.5.1.4.1.1.7")
    ds.SamplesPerPixel = 3
    ds.PhotometricInterpretation = "RGB"
    ds.PlanarConfiguration = 0
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    rng = np.random.default_rng(7)
    ds.PixelData = rng.integers(0, 256, size=(ROWS, COLS, 3), dtype=np.uint8).tobytes()
    ds["PixelData"].VR = "OB"
    save(ds, name)
    add_case(**expect_f07())


def expect_f07():
    name = "f07_rgb.dcm"
    rgb = np.frombuffer(file_pixel_bytes(name), dtype=np.uint8)[:ROWS * COLS * 3].reshape(ROWS, COLS, 3)
    y = luma(rgb[..., 0], rgb[..., 1], rgb[..., 2])
    return dict(file=name, ok=True, reason=None, label="RGB, SamplesPerPixel 3, planar 0 -> luminance",
                expect={"photometric": "RGB", "samplesPerPixel": 3, "pixelCodec": "native",
                        "window": {"center": 128, "width": 256, "source": "identity", "function": "LINEAR"}},
                gray8=write_gray(name, identity_gray8(y, 8)), raw16=y.ravel().tolist()[:64], raw16Type="Int32Array",
                warningsInclude=["colour_converted_to_luminance"])


# ----------------------------------------------------------------------------
# 8. Explicit VR Big Endian
# ----------------------------------------------------------------------------
def fixture_08():
    name = "f08_explicit_be.dcm"
    img = gradient_image(ROWS, COLS, 4095, 3000, seed=8)
    ds = base_dataset(ExplicitVRBigEndian)
    ds.PixelSpacing = [0.3, 0.3]
    ds.PixelData = img.astype(">u2").tobytes()
    ds["PixelData"].VR = "OW"
    path = os.path.join(FIX, name)
    try:
        ds.save_as(path, enforce_file_format=True)
    except Exception:
        ds.save_as(path, enforce_file_format=True, implicit_vr=False, little_endian=False)
    data = open(path, "rb").read()
    # sanity: after file meta, Rows element (0028,0010) should appear big endian
    assert b"\x00\x28\x00\x10US\x00\x02" in data, "fixture 8 was not written big endian"
    add_case(file=name, ok=False, reason="big_endian_unsupported", label="Explicit VR Big Endian",
             expect={"transferSyntaxUID": "1.2.840.10008.1.2.2", "rows": ROWS, "columns": COLS,
                     "pixelSpacingMm": {"row": 0.3, "col": 0.3, "source": "PixelSpacing"}, "gray8": None})


# ----------------------------------------------------------------------------
# 9. Truncated pixel data (fixture 1 cut short)
# ----------------------------------------------------------------------------
def fixture_09():
    name = "f09_truncated.dcm"
    src = open(os.path.join(FIX, "f01_implicit_mono2_16.dcm"), "rb").read()
    cut = len(src) - (ROWS * COLS * 2) // 2
    open(os.path.join(FIX, name), "wb").write(src[:cut])
    add_case(file=name, ok=False, reason="pixel_data_truncated", label="pixel data truncated (half missing)",
             expect={"rows": ROWS, "columns": COLS, "gray8": None})


# ----------------------------------------------------------------------------
# 10. Not DICOM: a JPEG-looking file renamed .dcm, random bytes, empty file
# ----------------------------------------------------------------------------
def fixture_10():
    rng = np.random.default_rng(10)
    jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + rng.integers(0, 256, 3000, dtype=np.uint8).tobytes() + b"\xff\xd9"
    open(os.path.join(FIX, "f10_jpeg_renamed.dcm"), "wb").write(jpeg)
    add_case(file="f10_jpeg_renamed.dcm", ok=False, reason="not_dicom", label="plain JPEG renamed .dcm", expect={"gray8": None})
    open(os.path.join(FIX, "f10_random.bin"), "wb").write(rng.integers(0, 256, 4096, dtype=np.uint8).tobytes())
    add_case(file="f10_random.bin", ok=False, reason="not_dicom", label="random bytes", expect={"gray8": None})
    open(os.path.join(FIX, "f10_empty.bin"), "wb").write(b"")
    add_case(file="f10_empty.bin", ok=False, reason="not_dicom", label="empty file", expect={"gray8": None})
    # preamble + DICM but nothing usable after it
    open(os.path.join(FIX, "f10_dicm_only.dcm"), "wb").write(b"\x00" * 128 + b"DICM")
    add_case(file="f10_dicm_only.dcm", ok=False, reason="pixel_data_missing", label="preamble + DICM only", expect={"gray8": None})


# ----------------------------------------------------------------------------
# 11. Privacy: identity tags, private blocks (incl. UN undefined-length with
#     implicit-VR items), trailing private group after PixelData
# ----------------------------------------------------------------------------
def implicit_element(group, elem, value):
    if len(value) % 2:
        value += b"\x00"
    return struct.pack("<HHI", group, elem, len(value)) + value


def fixture_11():
    name = "f11_privacy.dcm"
    img = gradient_image(ROWS, COLS, 4095, 3500, seed=11)
    ds = base_dataset(ExplicitVRLittleEndian)
    ds.PatientName = "SHOULD^NOT^BE^READ"
    ds.PatientID = "CANARY-ID-12345"
    ds.PatientBirthDate = "19000101"
    ds.PatientSex = "O"
    ds.InstitutionName = "CANARY INSTITUTION"
    ds.ReferringPhysicianName = "CANARY^PHYSICIAN"
    ds.PixelSpacing = [0.14, 0.14]
    ds.WindowCenter = "2000"
    ds.WindowWidth = "4000"
    # private block with several element types
    block = ds.private_block(0x0009, "SPINE TEST CREATOR", create=True)
    block.add_new(0x01, "LO", "PRIVATE CANARY LO")
    block.add_new(0x02, "OB", bytes(range(64)))
    block.add_new(0x03, "US", 4242)
    # a private sequence with defined length, containing an identity tag
    pitem = Dataset()
    pitem.PatientName = "SEQ^CANARY"
    block.add_new(0x04, "SQ", Sequence([pitem]))
    # an undefined-length UN private element whose content is an implicit-VR
    # item of undefined length containing a nested undefined-length sequence
    nested_seq_items = (
        b"\xfe\xff\x00\xe0\xff\xff\xff\xff"  # item, undefined length
        + implicit_element(0x0010, 0x0010, b"NESTED^CANARY")
        + implicit_element(0x0008, 0x0060, b"OT")
        + b"\xfe\xff\x0d\xe0\x00\x00\x00\x00"  # item delimiter
    )
    nested_seq = (
        struct.pack("<HHI", 0x0008, 0x1140, 0xFFFFFFFF)  # ReferencedImageSequence, undefined length (implicit VR)
        + nested_seq_items
        + b"\xfe\xff\xdd\xe0\x00\x00\x00\x00"  # sequence delimiter
    )
    un_item = (
        b"\xfe\xff\x00\xe0\xff\xff\xff\xff"  # item, undefined length
        + implicit_element(0x0010, 0x0010, b"NESTED^CANARY")
        + nested_seq
        + implicit_element(0x0028, 0x0010, struct.pack("<H", 7))  # a Rows inside a sequence must be ignored
        + b"\xfe\xff\x0d\xe0\x00\x00\x00\x00"
    )
    un_elem = DataElement((0x0009, 0x1005), "UN", un_item)
    un_elem.is_undefined_length = True
    ds.add(un_elem)
    # second private creator in a higher group, with a long LO
    block2 = ds.private_block(0x0029, "ANOTHER CREATOR", create=True)
    block2.add_new(0x10, "LT", "PRIVATE CANARY LO " * 40)
    ds.PixelData = img.astype("<u2").tobytes()
    ds["PixelData"].VR = "OW"
    # private group after pixel data
    ds.add_new((0x7FE1, 0x0010), "LO", "TRAILING CREATOR")
    ds.add_new((0x7FE1, 0x1001), "LO", "TRAILING PRIVATE CANARY")
    path = save(ds, name)
    data = open(path, "rb").read()
    assert data.count(b"\xfe\xff\xdd\xe0\x00\x00\x00\x00") >= 2, "UN undefined-length element not written as expected"
    # pydicom must still be able to read it (structural sanity)
    ds2 = pydicom.dcmread(path)
    assert ds2.Rows == ROWS and ds2.PatientName == "SHOULD^NOT^BE^READ"
    stored = img.astype(np.int64)
    g1 = window_to_gray8(stored, 2000, 4000)
    g2 = pydicom_gray8(ds2, ds2.pixel_array)
    assert np.abs(g1.astype(int) - g2.astype(int)).max() <= 1, "self-check f11"
    spans = canary_offsets(path)
    assert len(spans) >= 9, spans
    add_case(file=name, ok=True, reason=None, label="privacy: identity tags + private blocks (UN undefined length, implicit items) + trailing private group",
             expect={"rows": ROWS, "columns": COLS, "modality": "DX",
                     "window": {"center": 2000, "width": 4000, "source": "tag", "function": "LINEAR"},
                     "privacy": {"identityTagsRead": False}},
             gray8=write_gray(name, g1), raw16=stored.ravel().tolist()[:64], raw16Type="Int32Array",
             noWarnings=True, canaries=[c.decode("latin-1") for c in CANARIES], canarySpans=spans)


# ----------------------------------------------------------------------------
# 12. SIGMOID VOI LUT function + VOI LUT Sequence + conflicting spacings
# ----------------------------------------------------------------------------
def fixture_12():
    name = "f12_sigmoid_voilut_spacing.dcm"
    img = gradient_image(ROWS, COLS, 4095, 3500, seed=12)
    ds = base_dataset(ExplicitVRLittleEndian)
    ds.PixelSpacing = [0.2, 0.2]
    ds.ImagerPixelSpacing = [0.25, 0.25]
    ds.WindowCenter = "2048"
    ds.WindowWidth = "2048"
    ds.VOILUTFunction = "SIGMOID"
    lut = Dataset()
    lut.LUTDescriptor = [256, 0, 16]
    lut.LUTExplanation = "dummy"
    lut.add_new((0x0028, 0x3006), "OW", b"".join(struct.pack("<H", i) for i in range(256)))
    ds.VOILUTSequence = Sequence([lut])
    ds.PixelData = img.astype("<u2").tobytes()
    ds["PixelData"].VR = "OW"
    save(ds, name)
    stored = img.astype(np.int64)
    g1 = window_to_gray8(stored, 2048, 2048)
    add_case(file=name, ok=True, reason=None, label="SIGMOID VOILUTFunction (fallback LINEAR), VOI LUT Sequence, PixelSpacing != ImagerPixelSpacing",
             expect={"pixelSpacingMm": {"row": 0.2, "col": 0.2, "source": "PixelSpacing"},
                     "window": {"center": 2048, "width": 2048, "source": "tag", "function": "LINEAR", "functionTag": "SIGMOID"}},
             gray8=write_gray(name, g1),
             warningsInclude=["sigmoid_voi_lut_function_unsupported_using_linear", "pixel_spacing_differs_from_imager_pixel_spacing",
                              "voi_lut_sequence_ignored_window_tag_used"])


# ----------------------------------------------------------------------------
# 13. Signed + rescale + LINEAR_EXACT window (pydicom cross-check)
# ----------------------------------------------------------------------------
def fixture_13():
    name = "f13_signed_linear_exact.dcm"
    img = gradient_image(ROWS, COLS, 3000, 2500, seed=13) - 500
    ds = base_dataset(ExplicitVRLittleEndian, modality="CT", sop_class="1.2.840.10008.5.1.4.1.1.2")
    ds.PixelRepresentation = 1
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.RescaleIntercept = "-1024"
    ds.RescaleSlope = "1"
    ds.WindowCenter = "40"
    ds.WindowWidth = "400"
    ds.VOILUTFunction = "LINEAR_EXACT"
    ds.PixelData = img.astype("<i2").tobytes()
    ds["PixelData"].VR = "OW"
    save(ds, name)
    stored = img.astype(np.int64)
    g1 = window_to_gray8(stored - 1024, 40, 400, fn="LINEAR_EXACT")
    ds2 = pydicom.dcmread(os.path.join(FIX, name))
    g2 = pydicom_gray8(ds2, ds2.pixel_array)
    assert np.abs(g1.astype(int) - g2.astype(int)).max() <= 1, "self-check f13"
    add_case(file=name, ok=True, reason=None, label="signed 16-bit, rescale, LINEAR_EXACT window",
             expect={"pixelRepresentation": 1, "rescale": {"slope": 1, "intercept": -1024, "applied": True},
                     "window": {"center": 40, "width": 400, "source": "tag", "function": "LINEAR_EXACT"}},
             gray8=write_gray(name, g1), raw16=(stored - 1024).ravel().tolist()[:64], raw16Type="Int32Array", noWarnings=True)


# ----------------------------------------------------------------------------
# 14. Raw implicit VR dataset, no preamble, no file meta
# ----------------------------------------------------------------------------
def fixture_14():
    name = "f14_nopreamble_implicit.dcm"
    img = gradient_image(ROWS, COLS, 4095, 3000, seed=14)
    ds = base_dataset(ImplicitVRLittleEndian, modality="CR", sop_class="1.2.840.10008.5.1.4.1.1.1")
    ds.PixelSpacing = [0.175, 0.175]
    ds.WindowCenter = "2048"
    ds.WindowWidth = "4096"
    ds.PixelData = img.astype("<u2").tobytes()
    del ds.file_meta
    ds.preamble = None
    path = os.path.join(FIX, name)
    ds.save_as(path, enforce_file_format=False, implicit_vr=True, little_endian=True)
    data = open(path, "rb").read()
    assert data[:4] == b"\x08\x00\x16\x00", data[:8]
    stored = img.astype(np.int64)
    g1 = window_to_gray8(stored, 2048, 4096)
    add_case(file=name, ok=True, reason=None, label="raw implicit VR dataset, no preamble / file meta",
             expect={"transferSyntaxUID": None, "preamble": False, "rows": ROWS, "columns": COLS,
                     "pixelSpacingMm": {"row": 0.175, "col": 0.175, "source": "PixelSpacing"}},
             gray8=write_gray(name, g1), warningsInclude=["no_preamble", "file_meta_missing", "transfer_syntax_missing"])


# ----------------------------------------------------------------------------
# 15. Large 3000x3000 16-bit for timing
# ----------------------------------------------------------------------------
def fixture_15():
    name = "f15_large_3000x3000.dcm"
    rows = cols = 3000
    rng = np.random.default_rng(15)
    yy, xx = np.mgrid[0:rows, 0:cols]
    img = ((xx + yy) / (rows + cols - 2) * 12000 + rng.integers(0, 800, size=(rows, cols))).astype("<u2")
    img[1000:2000, 1200:1800] = 15000
    ds = base_dataset(ImplicitVRLittleEndian, rows=rows, cols=cols)
    ds.PixelSpacing = [0.1, 0.1]
    ds.WindowCenter = "7000"
    ds.WindowWidth = "14000"
    ds.PixelData = img.tobytes()
    save(ds, name)
    add_case(file=name, ok=True, reason=None, label="3000x3000 16-bit timing", timingMaxMs=1000,
             expect={"rows": rows, "columns": cols, "window": {"center": 7000, "width": 14000, "source": "tag"}})


# ----------------------------------------------------------------------------
# 16. VOI LUT Sequence only (no WindowCenter) -> warning + auto window
# ----------------------------------------------------------------------------
def fixture_16():
    name = "f16_voilut_only.dcm"
    img = gradient_image(ROWS, COLS, 4095, 3000, seed=16)
    ds = base_dataset(ExplicitVRLittleEndian)
    lut = Dataset()
    lut.LUTDescriptor = [256, 0, 16]
    lut.add_new((0x0028, 0x3006), "OW", b"".join(struct.pack("<H", i) for i in range(256)))
    ds.VOILUTSequence = Sequence([lut])
    ds["VOILUTSequence"].is_undefined_length = True
    ds.PixelData = img.astype("<u2").tobytes()
    ds["PixelData"].VR = "OW"
    save(ds, name)
    add_case(**expect_f16())


def expect_f16():
    # PS3.3 C.11.2.1.1: with no Window Center/Width the VOI LUT is applied.
    # This LUT (256 entries from 0, 16 bits per entry, data 0..255) maps every
    # stored value >= 255 to 255 of a 0..65535 output range, so the image is
    # almost black -- what the standard specifies for this dummy LUT.
    name = "f16_voilut_only.dcm"
    stored = np.frombuffer(file_pixel_bytes(name), dtype="<u2").astype(np.int64)[:ROWS * COLS].reshape(ROWS, COLS)
    table = np.arange(256)
    return dict(file=name, ok=True, reason=None, label="VOI LUT Sequence without WindowCenter -> VOI LUT applied",
                expect={"window": {"center": None, "width": None, "source": "voi_lut_sequence", "function": "LUT",
                                   "lut": {"entries": 256, "firstValueMapped": 0, "bitsPerEntry": 16}}},
                gray8=write_gray(name, voi_lut_gray8(stored, 0, table, 16)), noWarnings=True)


# ----------------------------------------------------------------------------
# 17-20. Deflated, missing pixel data, 32-bit, zero rows
# ----------------------------------------------------------------------------
def fixture_17_20():
    img = gradient_image(ROWS, COLS, 4095, 3000, seed=17)

    ds = base_dataset(DeflatedExplicitVRLittleEndian)
    ds.PixelData = img.astype("<u2").tobytes()
    ds["PixelData"].VR = "OW"
    save(ds, "f17_deflated.dcm")
    add_case(**expect_f17())

    ds = base_dataset(ExplicitVRLittleEndian)
    save(ds, "f18_no_pixeldata.dcm")
    add_case(file="f18_no_pixeldata.dcm", ok=False, reason="pixel_data_missing", label="no Pixel Data element",
             expect={"rows": ROWS, "columns": COLS, "gray8": None})

    ds = base_dataset(ExplicitVRLittleEndian)
    ds.BitsAllocated = 32
    ds.BitsStored = 32
    ds.HighBit = 31
    ds.PixelData = img.astype("<u4").tobytes()
    ds["PixelData"].VR = "OW"
    save(ds, "f19_bits32.dcm")
    add_case(file="f19_bits32.dcm", ok=False, reason="bits_unsupported", label="BitsAllocated 32",
             expect={"bitsAllocated": 32, "gray8": None})

    ds = base_dataset(ExplicitVRLittleEndian)
    ds.Rows = 0
    ds.PixelData = b""
    ds["PixelData"].VR = "OW"
    save(ds, "f20_zero_rows.dcm")
    add_case(file="f20_zero_rows.dcm", ok=False, reason="dimensions_invalid", label="Rows 0",
             expect={"rows": 0, "gray8": None})


def expect_f17():
    name = "f17_deflated.dcm"
    data = open(os.path.join(FIX, name), "rb").read()
    meta_len = struct.unpack_from("<I", data, 132 + 8)[0]
    body = data[132 + 12 + meta_len:]
    inflated = zlib.decompressobj(-15).decompress(body)
    stored = np.frombuffer(explicit_pixel_bytes(inflated), dtype="<u2").astype(np.int64)[:ROWS * COLS].reshape(ROWS, COLS)
    c, w = auto_window(stored, 1, 0)
    return dict(file=name, ok=False, reason="deflated_requires_async", label="Deflated Explicit VR LE (pydicom-written)",
                expect={"transferSyntaxUID": "1.2.840.10008.1.2.1.99", "gray8": None},
                **{"async": dict(ok=True, reason=None, gray8=write_gray(name, window_to_gray8(stored, c, w)),
                                 expect={"transferSyntaxUID": "1.2.840.10008.1.2.1.99", "rows": ROWS, "columns": COLS, "pixelCodec": "native",
                                         "window": {"center": c, "width": w, "source": "auto_percentile"}})})


# ----------------------------------------------------------------------------
# Reference pieces shared by the expectation code below (the spec, in numpy)
# ----------------------------------------------------------------------------

def explicit_pixel_bytes(data):
    """Value of the last Explicit VR (7FE0,0010) OB/OW element with a defined length."""
    best = -1
    for vr in (b"OW", b"OB"):
        best = max(best, data.rfind(b"\xe0\x7f\x10\x00" + vr + b"\x00\x00"))
    assert best >= 0, "no explicit-VR pixel data"
    n = struct.unpack_from("<I", data, best + 8)[0]
    return data[best + 12: best + 12 + n]


def file_pixel_bytes(name):
    return explicit_pixel_bytes(open(os.path.join(FIX, name), "rb").read())


def luma(r, g, b):
    """PS3.3 C.7.6.3.1.2: Y = 0.299 R + 0.587 G + 0.114 B, rounded half up; grey stays exact."""
    r, g, b = (np.asarray(x, dtype=np.int64) for x in (r, g, b))
    y = (299 * r + 587 * g + 114 * b + 500) // 1000
    return np.where((r == g) & (g == b), r, y)


def identity_gray8(y, bits):
    return window_to_gray8(np.asarray(y, dtype=np.int64), 2 ** (bits - 1), 2 ** bits)


def voi_lut_gray8(x, first, table, bits, invert=False):
    """PS3.3 C.11.2.1.1 VOI LUT: clamp to the table, output range 0 .. 2^bits-1 scaled to 0..255."""
    idx = np.clip(np.floor(np.asarray(x, dtype=np.float64) + 0.5).astype(np.int64) - first, 0, len(table) - 1)
    t8 = np.clip(np.rint(np.asarray(table, dtype=np.float64) * (255.0 / (2 ** bits - 1))), 0, 255)
    y = t8[idx]
    if invert:
        y = 255 - y
    return y.astype(np.uint8)


def sha1_i32(a):
    return hashlib.sha1(np.ascontiguousarray(np.asarray(a).ravel(), dtype="<i4").tobytes()).hexdigest()


# ----------------------------------------------------------------------------
# Byte-level DICOM writer for f21+ (no pydicom): Explicit / Implicit VR LE
# ----------------------------------------------------------------------------

LONG_VRS = {"OB", "OW", "OF", "SQ", "UT", "UN", "OD", "OL", "OV", "UC", "UR"}
SOP_DX = "1.2.840.10008.5.1.4.1.1.1.1"
SOP_SC = "1.2.840.10008.5.1.4.1.1.7"
TS_EXPL = "1.2.840.10008.1.2.1"
TS_IMPL = "1.2.840.10008.1.2"


def _pad(vr, b):
    if len(b) % 2:
        b += b"\x00" if vr in ("UI", "OB", "OW", "UN") else b" "
    return b


def el(g, e, vr, val, implicit=False):
    if isinstance(val, str):
        val = val.encode("latin-1")
    val = _pad(vr, val)
    if implicit:
        return struct.pack("<HHI", g, e, len(val)) + val
    if vr in LONG_VRS:
        return struct.pack("<HH2sHI", g, e, vr.encode(), 0, len(val)) + val
    return struct.pack("<HH2sH", g, e, vr.encode(), len(val)) + val


def u16s(*v):
    return struct.pack("<%dH" % len(v), *v)


def file_meta(ts, sop=SOP_DX, n=0):
    inst = "2.25.3141592653589793238462643383279502884%03d" % n
    body = (el(0x0002, 0x0001, "OB", b"\x00\x01") + el(0x0002, 0x0002, "UI", sop) + el(0x0002, 0x0003, "UI", inst) +
            el(0x0002, 0x0010, "UI", ts) + el(0x0002, 0x0012, "UI", "2.25.271828182845904523536"))
    return b"\x00" * 128 + b"DICM" + el(0x0002, 0x0000, "UL", struct.pack("<I", len(body))) + body


def dataset(rows, cols, photometric="MONOCHROME2", spp=1, bits=16, stored=None, signed=False, frames=None, planar=None,
            modality="DX", sop=SOP_DX, extra=(), implicit=False, n=0):
    """Top-level elements in tag order. `extra` = [(group, elem, vr, value)]; every
    fixture carries a PatientName that the decoder must never read."""
    stored = bits if stored is None else stored
    items = [(0x0008, 0x0016, "UI", sop), (0x0008, 0x0018, "UI", "2.25.3141592653589793238462643383279502884%03d" % n),
             (0x0008, 0x0060, "CS", modality), (0x0010, 0x0010, "PN", "FIXTURE^MUST^NOT^LEAK"),
             (0x0028, 0x0002, "US", u16s(spp)), (0x0028, 0x0004, "CS", photometric),
             (0x0028, 0x0010, "US", u16s(rows)), (0x0028, 0x0011, "US", u16s(cols)),
             (0x0028, 0x0100, "US", u16s(bits)), (0x0028, 0x0101, "US", u16s(stored)),
             (0x0028, 0x0102, "US", u16s(stored - 1)), (0x0028, 0x0103, "US", u16s(1 if signed else 0))]
    if planar is not None:
        items.append((0x0028, 0x0006, "US", u16s(planar)))
    if frames:
        items.append((0x0028, 0x0008, "IS", str(frames)))
    items.extend(extra)
    items.sort(key=lambda t: (t[0], t[1]))
    return b"".join(v if vr == "RAW" else el(g, e, vr, v, implicit) for g, e, vr, v in items)


def native_px(arr, implicit=False):
    """uint8 arrays -> OB; anything else -> 16-bit little-endian words (signed if negative)."""
    a = np.asarray(arr)
    if a.dtype == np.uint8:
        return el(0x7FE0, 0x0010, "OB", a.tobytes(), implicit)
    assert a.min() >= -32768 and a.max() <= 65535
    return el(0x7FE0, 0x0010, "OW", a.astype("<i2" if a.min() < 0 else "<u2").tobytes(), implicit)


def encapsulated(frames, bot=True):
    """frames: list of frames, each a list of fragment byte strings (PS3.5 A.4)."""
    items, offsets, off = [], [], 0
    for frags in frames:
        offsets.append(off)
        for f in frags:
            f = f + (b"\x00" if len(f) % 2 else b"")
            items.append(struct.pack("<HHI", 0xFFFE, 0xE000, len(f)) + f)
            off += 8 + len(f)
    table = struct.pack("<%dI" % len(offsets), *offsets) if bot else b""
    return (struct.pack("<HH2sHI", 0x7FE0, 0x0010, b"OB", 0, 0xFFFFFFFF) + struct.pack("<HHI", 0xFFFE, 0xE000, len(table)) + table +
            b"".join(items) + struct.pack("<HHI", 0xFFFE, 0xE0DD, 0))


def save_raw(name, data):
    with open(os.path.join(FIX, name), "wb") as f:
        f.write(data)
    return name


# ----------------------------------------------------------------------------
# Encoders: ITU-T T.81 process 14 (lossless JPEG) and PS3.5 Annex G (RLE)
# ----------------------------------------------------------------------------

def huffman_table(freq):
    """Code lengths per ITU-T T.81 Annex K.2 (as libjpeg's jpeg_gen_optimal_table):
    lengths <= 16 and a reserved pseudo-symbol keeps the all-ones code unused.
    freq: counts for categories 0..16. Returns (BITS[16], HUFFVAL, {sym: (code, len)})."""
    f = [float(x) for x in freq] + [1.0]
    n = len(f)
    codesize, others = [0] * n, [-1] * n
    while True:
        c1, v = -1, 1e30
        for i in range(n):
            if f[i] and f[i] <= v:
                v, c1 = f[i], i
        c2, v = -1, 1e30
        for i in range(n):
            if f[i] and f[i] <= v and i != c1:
                v, c2 = f[i], i
        if c2 < 0:
            break
        f[c1] += f[c2]
        f[c2] = 0
        codesize[c1] += 1
        while others[c1] >= 0:
            c1 = others[c1]
            codesize[c1] += 1
        others[c1] = c2
        codesize[c2] += 1
        while others[c2] >= 0:
            c2 = others[c2]
            codesize[c2] += 1
    bits = [0] * 33
    for i in range(n):
        if codesize[i]:
            bits[codesize[i]] += 1
    for i in range(32, 16, -1):
        while bits[i] > 0:
            j = i - 2
            while bits[j] == 0:
                j -= 1
            bits[i] -= 2
            bits[i - 1] += 1
            bits[j + 1] += 2
            bits[j] -= 1
    i = 16
    while bits[i] == 0:
        i -= 1
    bits[i] -= 1  # drop the reserved pseudo-symbol
    order = sorted([s for s in range(17) if codesize[s]], key=lambda s: (codesize[s], s))
    counts = bits[1:17]
    table, code, k = {}, 0, 0
    for length in range(1, 17):
        for _ in range(counts[length - 1]):
            table[order[k]] = (code, length)
            code += 1
            k += 1
        code <<= 1
    return counts, order, table


def lossless_predict(a, P, pt, predictor, restart_rows):
    """T.81 H.1.2.1 prediction (values already >> pt). First line of the scan and of
    every restart interval: 2^(P-Pt-1) then Ra; first column: Rb."""
    rows, cols = a.shape
    pred = np.zeros_like(a)
    for r in range(rows):
        if (restart_rows and r % restart_rows == 0) or r == 0:
            pred[r, 0] = 1 << (P - pt - 1)
            pred[r, 1:] = a[r, :-1]
            continue
        pred[r, 0] = a[r - 1, 0]
        ra, rb, rc = a[r, :-1], a[r - 1, 1:], a[r - 1, :-1]
        pred[r, 1:] = {1: ra, 2: rb, 3: rc, 4: ra + rb - rc, 5: ra + ((rb - rc) >> 1),
                       6: rb + ((ra - rc) >> 1), 7: (ra + rb) >> 1}[predictor]
    return pred


def jpeg_lossless(planes, P, predictor=1, pt=0, restart_rows=0, omit_eoi=False):
    """Single interleaved scan, 1 or more components with 1x1 sampling, one shared table."""
    planes = [np.asarray(p, dtype=np.int64) for p in planes]
    rows, cols = planes[0].shape
    nc = len(planes)
    diffs = []
    for a in planes:
        a = a >> pt
        d = (a - lossless_predict(a, P, pt, predictor, restart_rows)) % 65536
        diffs.append(np.where(d >= 32768, d - 65536, d).ravel())
    diff = np.stack(diffs, axis=1).ravel()  # pixel-major, then component
    mag = np.abs(diff)
    cat = np.zeros_like(mag)
    nz = mag > 0
    cat[nz] = np.floor(np.log2(mag[nz])).astype(np.int64) + 1
    cat[diff == -32768] = 16
    counts, order, table = huffman_table([int((cat == s).sum()) for s in range(17)])
    out = bytearray()
    acc = nb = 0

    def put(v, n):
        nonlocal acc, nb
        acc = (acc << n) | (v & ((1 << n) - 1))
        nb += n
        while nb >= 8:
            b = (acc >> (nb - 8)) & 0xFF
            nb -= 8
            out.append(b)
            if b == 0xFF:
                out.append(0)
        acc &= (1 << nb) - 1

    def flush():
        if nb:
            put((1 << (8 - nb)) - 1, 8 - nb)

    interval = restart_rows * cols * nc
    rst = 0
    for i, (d, s) in enumerate(zip(diff.tolist(), cat.tolist())):
        if interval and i and i % interval == 0:
            flush()
            out.extend(bytes([0xFF, 0xD0 + (rst & 7)]))
            rst += 1
        c, length = table[s]
        put(c, length)
        if s and s != 16:
            put(d if d > 0 else d - 1, s)
    flush()
    ids = [1] if nc == 1 else list(b"RGB")[:nc]  # 'R','G','B' ids: libjpeg then treats 3 components as RGB
    sof = struct.pack(">BHHB", P, rows, cols, nc) + b"".join(bytes([i, 0x11, 0]) for i in ids)
    dht = bytes([0x00]) + bytes(counts) + bytes(order)
    sos = bytes([nc]) + b"".join(bytes([i, 0x00]) for i in ids) + bytes([predictor, 0, pt])
    head = b"\xFF\xD8" + b"\xFF\xC3" + struct.pack(">H", 2 + len(sof)) + sof + b"\xFF\xC4" + struct.pack(">H", 2 + len(dht)) + dht
    if restart_rows:
        head += b"\xFF\xDD" + struct.pack(">HH", 4, restart_rows * cols)
    head += b"\xFF\xDA" + struct.pack(">H", 2 + len(sos)) + sos
    return head + bytes(out) + (b"" if omit_eoi else b"\xFF\xD9")


def check_with_libjpeg(stream, planes):
    """8-bit lossless streams must decode bit-exactly in OpenCV's libjpeg-turbo 3."""
    try:
        import cv2
    except ImportError:
        print("  (OpenCV not available: libjpeg-turbo cross-check skipped)")
        return
    got = cv2.imdecode(np.frombuffer(stream, np.uint8), cv2.IMREAD_UNCHANGED)
    assert got is not None, "libjpeg-turbo rejected the lossless stream"
    want = planes[0] if len(planes) == 1 else np.stack(planes[::-1], axis=-1)  # OpenCV returns BGR
    assert got.shape == want.shape and int(np.abs(got.astype(int) - want.astype(int)).max()) == 0, "libjpeg-turbo decode differs"


def packbits(row):
    out, i, n = bytearray(), 0, len(row)
    while i < n:
        j = i
        while j + 1 < n and row[j + 1] == row[i] and j - i < 127:
            j += 1
        if j > i:
            out += bytes([(257 - (j - i + 1)) & 0xFF, row[i]])
            i = j + 1
            continue
        lit = bytearray()
        while i < n and len(lit) < 128 and not (i + 1 < n and row[i + 1] == row[i]):
            lit.append(row[i])
            i += 1
        out.append(len(lit) - 1)
        out += lit
    return bytes(out)


def rle_frame(planes, bytes_per_sample):
    """One segment per byte plane, most significant byte first, per sample; rows coded separately."""
    segs = []
    for plane in planes:
        a = np.asarray(plane, dtype=np.int64)
        for k in range(bytes_per_sample - 1, -1, -1):
            bp = ((a >> (8 * k)) & 0xFF).astype(np.uint8)
            s = b"".join(packbits(bytes(r)) for r in bp)
            segs.append(s + (b"\x00" if len(s) % 2 else b""))
    offs, off = [], 64
    for s in segs:
        offs.append(off)
        off += len(s)
    return struct.pack("<I", len(segs)) + b"".join(struct.pack("<I", o) for o in offs) + b"\x00" * 4 * (15 - len(offs)) + b"".join(segs)


# ----------------------------------------------------------------------------
# Image content for f21+
# ----------------------------------------------------------------------------

SAMPLES = os.path.join(HERE, "..", "..", "samples")


def radiograph_crop(sample, box, bits, seed):
    """A crop of one of the repository's sample radiographs, scaled to `bits` with a little noise."""
    from PIL import Image
    g = np.asarray(Image.open(os.path.join(SAMPLES, sample)).convert("L").crop(box)).astype(np.float64)
    rng = np.random.default_rng(seed)
    v = g * ((2 ** bits - 1) / 255.0) + rng.normal(0, 2 ** (bits - 9), g.shape)
    return np.clip(np.rint(v), 0, 2 ** bits - 1).astype(np.int64)


def add_codec_case(name, stored, gray, raw=None, **kw):
    raw = stored if raw is None else raw
    kw.setdefault("ok", True)
    kw.setdefault("reason", None)
    add_case(file=name, gray8=write_gray(name, gray), raw16=np.asarray(raw).ravel().tolist()[:64], raw16Type="Int32Array",
             raw16Sha1=sha1_i32(raw), **kw)


ORIENT_AP = [(0x0018, 0x1110, "DS", "1800"), (0x0018, 0x1111, "DS", "1565.2"), (0x0018, 0x1114, "DS", "1.150"),
             (0x0018, 0x1164, "DS", "0.150\\0.150"), (0x0018, 0x5101, "CS", "AP"), (0x0020, 0x0020, "CS", "L\\F")]
ORIENT_LAT = [(0x0018, 0x1114, "DS", "1.180"), (0x0018, 0x1164, "DS", "0.150\\0.150"), (0x0018, 0x5101, "CS", "LL"),
              (0x0020, 0x0020, "CS", "A\\F"), (0x0020, 0x0062, "CS", "L"), (0x0028, 0x0030, "DS", "0.127\\0.127"),
              (0x0028, 0x0A02, "CS", "GEOMETRY")]


def codec_fixtures():
    # ---- 21: JPEG Lossless SV1, 12-bit, real radiograph texture, AP view tags
    name = "f21_jpeg_lossless_sv1_12bit.dcm"
    img = radiograph_crop("1.jpg", (392, 100, 560, 420), 12, 21)
    rows, cols = img.shape
    check_with_libjpeg(jpeg_lossless([img >> 4], 8), [img >> 4])
    stream = jpeg_lossless([img], 12)
    save_raw(name, file_meta("1.2.840.10008.1.2.4.70", n=21) + dataset(rows, cols, stored=12, n=21, extra=ORIENT_AP + [
        (0x0028, 0x1050, "DS", "2048"), (0x0028, 0x1051, "DS", "4096")]) + encapsulated([[stream]]))
    add_codec_case(name, img, window_to_gray8(img, 2048, 4096), label="JPEG Lossless SV1 (4.70), P=12, predictor 1, AP view/orientation/magnification tags",
                   noWarnings=True,
                   expect={"transferSyntaxUID": "1.2.840.10008.1.2.4.70", "rows": rows, "columns": cols, "pixelCodec": "jpeg_lossless", "frameDecoded": 1,
                           "bitsStored": 12, "window": {"center": 2048, "width": 4096, "source": "tag"},
                           "pixelSpacingMm": {"row": 0.15, "col": 0.15, "source": "ImagerPixelSpacing"},
                           "orientation": {"viewPosition": "AP", "rowDirection": "L", "columnDirection": "F", "imageLaterality": None},
                           "calibration": {"pixelSpacingCalibrationType": None, "estimatedRadiographicMagnificationFactor": 1.15,
                                           "distanceSourceToDetectorMm": 1800, "distanceSourceToPatientMm": 1565.2},
                           "displayInverted": False, "presentationLutShape": None})

    # ---- 22: JPEG Lossless process 14 (4.57), P=16, predictor 6, restarts,
    #          MONOCHROME1 + Presentation LUT Shape INVERSE (the conformant DX pair: ONE inversion)
    name = "f22_jpeg_lossless_p16_pred6_rst_mono1.dcm"
    img = gradient_image(ROWS, COLS, 60000, 64000, seed=22)
    stream = jpeg_lossless([img], 16, predictor=6, restart_rows=8)
    save_raw(name, file_meta("1.2.840.10008.1.2.4.57", n=22) + dataset(ROWS, COLS, photometric="MONOCHROME1", n=22, extra=[
        (0x0028, 0x1050, "DS", "30000"), (0x0028, 0x1051, "DS", "50000"), (0x2050, 0x0020, "CS", "INVERSE")]) + encapsulated([[stream]]))
    add_codec_case(name, img, window_to_gray8(img, 30000, 50000, invert=True), noWarnings=True,
                   label="JPEG Lossless (4.57), P=16, predictor 6, restart every 8 lines, MONOCHROME1 + INVERSE",
                   expect={"pixelCodec": "jpeg_lossless", "photometric": "MONOCHROME1", "presentationLutShape": "INVERSE", "displayInverted": True,
                           "window": {"center": 30000, "width": 50000, "source": "tag"}})

    # ---- 23-27: small predictor / precision / point-transform / sign sweep
    sweep = [
        ("f23_jpeg_lossless_pred2_p8.dcm", 2, 8, 0, 0, 8, False),
        ("f24_jpeg_lossless_pred3_p10_pt1.dcm", 3, 10, 1, 0, 16, False),
        ("f25_jpeg_lossless_pred4_p12_signed.dcm", 4, 12, 0, 0, 16, True),
        ("f26_jpeg_lossless_pred5_p15_rst.dcm", 5, 15, 0, 5, 16, False),
        ("f27_jpeg_lossless_pred7_p16.dcm", 7, 16, 2, 3, 16, False),
    ]
    for k, (name, pred, P, pt, rst, alloc, signed) in enumerate(sweep):
        r_, c_ = 40, 56
        rng = np.random.default_rng(23 + k)
        yy, xx = np.mgrid[0:r_, 0:c_]
        top = 2 ** P - 1
        base = (xx / (c_ - 1) * 0.7 + yy / (r_ - 1) * 0.3) * top
        img = np.clip(np.rint(base + rng.normal(0, top * 0.02, base.shape)), 0, top).astype(np.int64)
        img[5:9, 10:20] = top  # saturated block exercises large differences
        if signed:
            vals = img - 2 ** (P - 1)                # -2048 .. 2047
            coded = vals & (2 ** P - 1)              # two's complement bit pattern
        else:
            vals, coded = (img >> pt) << pt, img
        stream = jpeg_lossless([coded], P, predictor=pred, pt=pt, restart_rows=rst)
        if P == 8:
            check_with_libjpeg(stream, [coded])
        extra = [(0x0028, 0x1052, "DS", "-1024"), (0x0028, 0x1053, "DS", "1")] if signed else []
        save_raw(name, file_meta("1.2.840.10008.1.2.4.57", n=23 + k) +
                 dataset(r_, c_, bits=alloc, stored=P, signed=signed, n=23 + k, extra=extra) + encapsulated([[stream]]))
        raw = vals - 1024 if signed else vals
        c, w = auto_window(vals, 1, -1024 if signed else 0)
        add_codec_case(name, vals, window_to_gray8(raw, c, w), raw=raw,
                       label="JPEG Lossless (4.57) predictor %d, P=%d, Pt=%d%s%s" % (pred, P, pt, ", restart every %d lines" % rst if rst else "", ", signed + rescale" if signed else ""),
                       expect={"pixelCodec": "jpeg_lossless", "rows": r_, "columns": c_, "window": {"center": c, "width": w, "source": "auto_percentile"}})

    # ---- 28: JPEG Lossless RGB, three interleaved components -> luminance
    name = "f28_jpeg_lossless_rgb.dcm"
    rgb = [radiograph_crop("2-1.jpg", (300, 200, 364, 280), 8, 28 + k) for k in range(3)]
    rgb[2] = np.clip(rgb[2] + 40, 0, 255)
    stream = jpeg_lossless(rgb, 8, predictor=1)
    check_with_libjpeg(stream, rgb)
    r_, c_ = rgb[0].shape
    save_raw(name, file_meta(TS_JPEG_LL, sop=SOP_SC, n=28) + dataset(r_, c_, photometric="RGB", spp=3, bits=8, planar=0, modality="OT", sop=SOP_SC, n=28) +
             encapsulated([[stream]]))
    y = luma(*rgb)
    add_codec_case(name, y, identity_gray8(y, 8), label="JPEG Lossless SV1, RGB (3 interleaved components) -> luminance",
                   expect={"pixelCodec": "jpeg_lossless", "photometric": "RGB", "window": {"center": 128, "width": 256, "source": "identity"}},
                   warningsInclude=["colour_converted_to_luminance"])

    # ---- 29 / 30: two-frame JPEG Lossless, frame 1 split into two fragments;
    #               with a Basic Offset Table, and without one (EOI delimits the frame)
    f1 = gradient_image(ROWS, COLS, 4095, 3900, seed=29)
    f2 = 4095 - f1
    s1, s2 = jpeg_lossless([f1], 12), jpeg_lossless([f2], 12)
    cut = (len(s1) // 2) & ~1  # fragments are even-length (PS3.5 A.4): split on an even byte
    for name, bot in (("f29_jpeg_lossless_2frames_bot.dcm", True), ("f30_jpeg_lossless_2frames_nobot.dcm", False)):
        save_raw(name, file_meta(TS_JPEG_LL, n=29) + dataset(ROWS, COLS, stored=12, frames=2, n=29, extra=[
            (0x0028, 0x1050, "DS", "2048"), (0x0028, 0x1051, "DS", "4096")]) + encapsulated([[s1[:cut], s1[cut:]], [s2]], bot=bot))
        add_codec_case(name, f1, window_to_gray8(f1, 2048, 4096),
                       label="2-frame JPEG Lossless, frame 1 in 2 fragments, %s -> frame 1" % ("Basic Offset Table" if bot else "empty offset table"),
                       expect={"numberOfFrames": 2, "frameDecoded": 1, "pixelCodec": "jpeg_lossless"}, warningsInclude=["multi_frame_first_frame_used"])

    # ---- 31: truncated lossless bitstream must fail closed
    name = "f31_jpeg_lossless_truncated.dcm"
    s = jpeg_lossless([f1], 12, omit_eoi=True)
    save_raw(name, file_meta(TS_JPEG_LL, n=31) + dataset(ROWS, COLS, stored=12, n=31) + encapsulated([[s[: int(len(s) * 0.6)]]]))
    add_case(file=name, ok=False, reason="jpeg_data_corrupt", label="JPEG Lossless bitstream cut at 60%", expect={"gray8": None, "rows": ROWS})

    # ---- 32: RLE, 16/12-bit, lateral with calibrated PixelSpacing and view tags
    name = "f32_rle_16bit_lateral.dcm"
    img = radiograph_crop("2.jpg", (400, 200, 528, 296), 12, 32)
    r_, c_ = img.shape
    save_raw(name, file_meta("1.2.840.10008.1.2.5", n=32) + dataset(r_, c_, stored=12, n=32, extra=ORIENT_LAT + [
        (0x0028, 0x1050, "DS", "2000"), (0x0028, 0x1051, "DS", "3500")]) + encapsulated([[rle_frame([img], 2)]]))
    add_codec_case(name, img, window_to_gray8(img, 2000, 3500), label="RLE Lossless, 16/12-bit, lateral (LL, A\\F), calibrated PixelSpacing",
                   expect={"pixelCodec": "rle_lossless", "transferSyntaxUID": "1.2.840.10008.1.2.5",
                           "pixelSpacingMm": {"row": 0.127, "col": 0.127, "source": "PixelSpacing"},
                           "orientation": {"viewPosition": "LL", "rowDirection": "A", "columnDirection": "F", "imageLaterality": "L"},
                           "calibration": {"pixelSpacingCalibrationType": "GEOMETRY", "estimatedRadiographicMagnificationFactor": 1.18,
                                           "distanceSourceToDetectorMm": None, "distanceSourceToPatientMm": None}},
                   warningsInclude=["pixel_spacing_differs_from_imager_pixel_spacing"])

    # ---- 33: RLE RGB (three segments) -> luminance
    name = "f33_rle_rgb.dcm"
    rgb = [radiograph_crop("1.jpg", (400, 300, 480, 360), 8, 33 + k) for k in range(3)]
    rgb[0] = np.clip(rgb[0] + 25, 0, 255)
    r_, c_ = rgb[0].shape
    save_raw(name, file_meta("1.2.840.10008.1.2.5", sop=SOP_SC, n=33) + dataset(r_, c_, photometric="RGB", spp=3, bits=8, planar=1, modality="OT", sop=SOP_SC, n=33) +
             encapsulated([[rle_frame(rgb, 1)]]))
    y = luma(*rgb)
    add_codec_case(name, y, identity_gray8(y, 8), label="RLE Lossless RGB (3 segments) -> luminance",
                   expect={"pixelCodec": "rle_lossless", "window": {"source": "identity"}}, warningsInclude=["colour_converted_to_luminance"])

    # ---- 34: RLE 8-bit, 2 frames (one fragment per frame, empty offset table)
    name = "f34_rle_2frames.dcm"
    a = gradient_image(ROWS, COLS, 255, 250, seed=34)
    save_raw(name, file_meta("1.2.840.10008.1.2.5", n=34) + dataset(ROWS, COLS, bits=8, frames=2, n=34) +
             encapsulated([[rle_frame([a], 1)], [rle_frame([255 - a], 1)]], bot=False))
    c, w = auto_window(a, 1, 0)
    add_codec_case(name, a, window_to_gray8(a, c, w), label="RLE Lossless 8-bit, 2 frames, no offset table -> frame 1",
                   expect={"numberOfFrames": 2, "frameDecoded": 1, "pixelCodec": "rle_lossless"}, warningsInclude=["multi_frame_first_frame_used"])

    # ---- 35: RLE segment too short must fail closed
    name = "f35_rle_truncated.dcm"
    fr = rle_frame([gradient_image(ROWS, COLS, 4095, 4000, seed=35)], 2)
    save_raw(name, file_meta("1.2.840.10008.1.2.5", n=35) + dataset(ROWS, COLS, stored=12, n=35) + encapsulated([[fr[: len(fr) - 400]]]))
    add_case(file=name, ok=False, reason="rle_data_corrupt", label="RLE with its last segment cut short", expect={"gray8": None})

    # ---- 36 / 37: native colour, planar configuration 1 and YBR_FULL_422
    name = "f36_native_rgb_planar1.dcm"
    rng = np.random.default_rng(36)
    rgb = [np.clip(gradient_image(ROWS, COLS, 255, 200 + 20 * k, seed=36 + k) + rng.integers(-20, 20, (ROWS, COLS)), 0, 255) for k in range(3)]
    save_raw(name, file_meta(TS_EXPL, sop=SOP_SC, n=36) + dataset(ROWS, COLS, photometric="RGB", spp=3, bits=8, planar=1, modality="OT", sop=SOP_SC, n=36) +
             native_px(np.stack(rgb).astype(np.uint8)))
    y = luma(*rgb)
    add_codec_case(name, y, identity_gray8(y, 8), label="native RGB, Planar Configuration 1 -> luminance",
                   expect={"pixelCodec": "native"}, warningsInclude=["colour_converted_to_luminance"])
    name = "f37_native_ybr_full_422.dcm"
    yy = gradient_image(ROWS, COLS, 255, 240, seed=37)
    cb = np.full((ROWS, COLS // 2), 100)
    cr = np.full((ROWS, COLS // 2), 160)
    packed = np.stack([yy[:, 0::2], yy[:, 1::2], cb, cr], axis=-1).astype(np.uint8)  # Y1 Y2 Cb Cr
    save_raw(name, file_meta(TS_EXPL, sop=SOP_SC, n=37) + dataset(ROWS, COLS, photometric="YBR_FULL_422", spp=3, bits=8, planar=0, modality="OT", sop=SOP_SC, n=37) +
             native_px(packed))
    add_codec_case(name, yy, identity_gray8(yy, 8), label="native YBR_FULL_422 (Y1 Y2 Cb Cr) -> Y", expect={"pixelCodec": "native"})

    # ---- 38 / 39: Presentation LUT Shape disagreeing with the photometric interpretation
    name = "f38_mono2_plut_inverse.dcm"
    img = gradient_image(ROWS, COLS, 4095, 3900, seed=38)
    inv = 4095 - img
    save_raw(name, file_meta(TS_EXPL, n=38) + dataset(ROWS, COLS, stored=12, n=38, extra=[
        (0x0028, 0x1050, "DS", "2048"), (0x0028, 0x1051, "DS", "4096"), (0x2050, 0x0020, "CS", "INVERSE")]) + native_px(inv))
    add_codec_case(name, inv, window_to_gray8(inv, 2048, 4096, invert=True),
                   label="MONOCHROME2 + Presentation LUT Shape INVERSE (stored data inverted) -> displayed inverted",
                   expect={"displayInverted": True, "presentationLutShape": "INVERSE"}, warningsInclude=["presentation_lut_inverse_applied_to_monochrome2"])
    name = "f39_mono1_plut_identity.dcm"
    save_raw(name, file_meta(TS_EXPL, n=39) + dataset(ROWS, COLS, photometric="MONOCHROME1", stored=12, n=39, extra=[
        (0x0028, 0x1050, "DS", "2048"), (0x0028, 0x1051, "DS", "4096"), (0x2050, 0x0020, "CS", "IDENTITY")]) + native_px(img))
    add_codec_case(name, img, window_to_gray8(img, 2048, 4096, invert=True),
                   label="MONOCHROME1 + Presentation LUT Shape IDENTITY (non-conformant) -> MONOCHROME1 still inverts once",
                   expect={"displayInverted": True, "presentationLutShape": "IDENTITY"}, warningsInclude=["presentation_lut_identity_ignored_for_monochrome1"])

    # ---- 40: VOI LUT Sequence (explicit VR, undefined lengths) with canaries in
    #          the LUT Explanation and in a nested sequence of the item
    name = "f40_voi_lut_16bit.dcm"
    img = radiograph_crop("1.jpg", (392, 400, 520, 496), 12, 40)
    r_, c_ = img.shape
    xs = np.arange(4096)
    table = np.rint(65535.0 / (1.0 + np.exp(-(xs - 2300) / 420.0))).astype(np.int64)
    nested = (struct.pack("<HH2sHI", 0x0008, 0x1140, b"SQ", 0, 0xFFFFFFFF) + struct.pack("<HHI", 0xFFFE, 0xE000, 0xFFFFFFFF) +
              el(0x0010, 0x0010, "PN", "VOI^NESTED^CANARY") + struct.pack("<HHI", 0xFFFE, 0xE00D, 0) + struct.pack("<HHI", 0xFFFE, 0xE0DD, 0))
    # (0008,1140) sorts before the (0028,300x) LUT elements inside the item
    item = (nested + el(0x0028, 0x3002, "US", u16s(4096, 0, 16)) + el(0x0028, 0x3003, "LO", "CANARY LUT EXPLANATION") +
            el(0x0028, 0x3006, "OW", u16s(*table.tolist())))
    seq = (struct.pack("<HH2sHI", 0x0028, 0x3010, b"SQ", 0, 0xFFFFFFFF) + struct.pack("<HHI", 0xFFFE, 0xE000, 0xFFFFFFFF) + item +
           struct.pack("<HHI", 0xFFFE, 0xE00D, 0) + struct.pack("<HHI", 0xFFFE, 0xE0DD, 0))
    path = save_raw(name, file_meta(TS_EXPL, n=40) + dataset(r_, c_, stored=12, n=40, extra=[(0x0028, 0x3010, "RAW", seq)]) + native_px(img))
    spans = [[off, len(cn)] for cn in (b"CANARY LUT EXPLANATION", b"VOI^NESTED^CANARY", b"FIXTURE^MUST^NOT^LEAK")
             for off in find_all(open(os.path.join(FIX, path), "rb").read(), cn)]
    add_codec_case(name, img, voi_lut_gray8(img, 0, table, 16), label="VOI LUT Sequence (4096 x 16-bit sigmoid), no window -> LUT applied; canaries in the item",
                   noWarnings=True, canaries=["CANARY LUT EXPLANATION", "VOI^NESTED^CANARY", "FIXTURE^MUST^NOT^LEAK"], canarySpans=spans,
                   expect={"window": {"center": None, "width": None, "source": "voi_lut_sequence", "function": "LUT",
                                      "lut": {"entries": 4096, "firstValueMapped": 0, "bitsPerEntry": 16}}})

    # ---- 41: VOI LUT, implicit VR, defined lengths, signed input, negative first value mapped
    name = "f41_voi_lut_implicit_signed.dcm"
    img = gradient_image(ROWS, COLS, 3000, 2900, seed=41) - 1500  # -1500 .. 1500
    xs = np.arange(2048)
    table = np.rint(4095 * (xs / 2047.0) ** 0.7).astype(np.int64)
    item = el(0x0028, 0x3002, "US", u16s(2048, (-1024) & 0xFFFF, 12), True) + el(0x0028, 0x3006, "OW", u16s(*table.tolist()), True)
    seq_val = struct.pack("<HHI", 0xFFFE, 0xE000, len(item)) + item
    seq = struct.pack("<HHI", 0x0028, 0x3010, len(seq_val)) + seq_val
    save_raw(name, file_meta(TS_IMPL, n=41) + dataset(ROWS, COLS, stored=16, signed=True, implicit=True, n=41, extra=[(0x0028, 0x3010, "RAW", seq)]) +
             native_px(img.astype("<i2"), implicit=True))
    add_codec_case(name, img, voi_lut_gray8(img, -1024, table, 12), label="VOI LUT, implicit VR, signed pixels, first value mapped -1024, 12-bit entries",
                   noWarnings=True, expect={"window": {"source": "voi_lut_sequence", "lut": {"entries": 2048, "firstValueMapped": -1024, "bitsPerEntry": 12}}})

    # ---- 42: VOI LUT with 8-bit entries packed one per byte (value length == entries)
    name = "f42_voi_lut_8bit_bytes.dcm"
    img = gradient_image(ROWS, COLS, 1023, 1000, seed=42)
    table = np.clip(np.rint(np.arange(256) * 1.3 - 40), 0, 255).astype(np.uint8)
    item = el(0x0028, 0x3002, "US", u16s(256, 256, 8)) + el(0x0028, 0x3006, "OW", table.tobytes())
    seq = struct.pack("<HH2sHI", 0x0028, 0x3010, b"SQ", 0, 8 + len(item)) + struct.pack("<HHI", 0xFFFE, 0xE000, len(item)) + item
    save_raw(name, file_meta(TS_EXPL, n=42) + dataset(ROWS, COLS, stored=10, n=42, extra=[(0x0028, 0x3010, "RAW", seq)]) + native_px(img))
    add_codec_case(name, img, voi_lut_gray8(img, 256, table.astype(np.int64), 8), noWarnings=True,
                   label="VOI LUT with 8-bit entries stored one per byte, first value mapped 256",
                   expect={"window": {"source": "voi_lut_sequence", "lut": {"entries": 256, "firstValueMapped": 256, "bitsPerEntry": 8}}})

    # ---- 43: Deflated Explicit VR LE whose deflate stream has an odd length (0x00 pad byte)
    name = "f43_deflated_padded.dcm"
    img = gradient_image(ROWS, COLS, 4095, 3000, seed=43)
    for extra_len in range(0, 40):
        body = dataset(ROWS, COLS, stored=12, n=43, extra=ORIENT_AP + [(0x0008, 0x0070, "LO", "X" * extra_len), (0x0028, 0x1050, "DS", "1800"),
                                                                     (0x0028, 0x1051, "DS", "3600")]) + native_px(img)
        co = zlib.compressobj(9, zlib.DEFLATED, -15)
        defl = co.compress(body) + co.flush()
        if len(defl) % 2:
            break
    assert len(defl) % 2 == 1
    save_raw(name, file_meta("1.2.840.10008.1.2.1.99", n=43) + defl + b"\x00")
    add_case(file=name, ok=False, reason="deflated_requires_async", label="Deflated Explicit VR LE, odd-length stream + pad byte",
             expect={"transferSyntaxUID": "1.2.840.10008.1.2.1.99", "gray8": None},
             **{"async": dict(ok=True, reason=None, gray8=write_gray(name, window_to_gray8(img, 1800, 3600)), raw16Sha1=sha1_i32(img),
                              expect={"rows": ROWS, "columns": COLS, "pixelCodec": "native", "window": {"center": 1800, "width": 3600, "source": "tag"},
                                      "orientation": {"viewPosition": "AP", "rowDirection": "L", "columnDirection": "F"}})})

    # ---- 44 / 45: lossy JPEG baseline, decoded by the browser (async only)
    from PIL import Image
    name = "f44_jpeg_baseline_mono.dcm"
    g8 = radiograph_crop("1.jpg", (392, 200, 520, 296), 8, 44).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(g8).save(buf, "JPEG", quality=90)
    jpg = buf.getvalue()
    ref = np.asarray(Image.open(io.BytesIO(jpg)).convert("L")).astype(np.int64)
    r_, c_ = ref.shape
    n3 = (len(jpg) // 3) & ~1  # even-length fragments (PS3.5 A.4)
    save_raw(name, file_meta("1.2.840.10008.1.2.4.50", n=44) + dataset(r_, c_, bits=8, n=44, extra=ORIENT_AP) +
             encapsulated([[jpg[:n3], jpg[n3:2 * n3], jpg[2 * n3:]]]))
    save_raw(name + ".ref.rgb", np.stack([ref] * 3, axis=-1).astype(np.uint8).tobytes())
    c, w = auto_window(ref, 1, 0)
    add_case(file=name, ok=False, reason="jpeg_lossy_requires_async", label="JPEG Baseline (4.50), 8-bit grey, 3 fragments (browser decoder)",
             expect={"transferSyntaxUID": "1.2.840.10008.1.2.4.50", "gray8": None, "rows": r_},
             jpegStreamSha1=hashlib.sha1(jpg).hexdigest(), jpegReference=name + ".ref.rgb",
             **{"async": dict(ok=True, reason=None, gray8=write_gray(name, window_to_gray8(ref, c, w)), raw16Sha1=sha1_i32(ref),
                              expect={"pixelCodec": "jpeg_browser", "window": {"center": c, "width": w, "source": "auto_percentile"}})})
    name = "f45_jpeg_baseline_ybr.dcm"
    rgb = np.stack([radiograph_crop("2-1.jpg", (300, 200, 396, 272), 8, 45 + k) for k in range(3)], axis=-1)
    rgb[..., 2] = np.clip(rgb[..., 2] + 30, 0, 255)
    buf = io.BytesIO()
    Image.fromarray(rgb.astype(np.uint8)).save(buf, "JPEG", quality=92, subsampling=1)
    jpg = buf.getvalue()
    ref = np.asarray(Image.open(io.BytesIO(jpg)).convert("RGB")).astype(np.int64)
    r_, c_ = ref.shape[:2]
    save_raw(name, file_meta("1.2.840.10008.1.2.4.50", sop=SOP_SC, n=45) + dataset(r_, c_, photometric="YBR_FULL_422", spp=3, bits=8, planar=0, modality="OT", sop=SOP_SC, n=45) +
             encapsulated([[jpg]]))
    save_raw(name + ".ref.rgb", ref.astype(np.uint8).tobytes())
    y = luma(ref[..., 0], ref[..., 1], ref[..., 2])
    add_case(file=name, ok=False, reason="jpeg_lossy_requires_async", label="JPEG Baseline (4.50), YBR_FULL_422 colour (browser decoder) -> luminance",
             expect={"gray8": None, "photometric": "YBR_FULL_422"}, jpegStreamSha1=hashlib.sha1(jpg).hexdigest(), jpegReference=name + ".ref.rgb",
             **{"async": dict(ok=True, reason=None, gray8=write_gray(name, identity_gray8(y, 8)), raw16Sha1=sha1_i32(y),
                              expect={"pixelCodec": "jpeg_browser", "window": {"source": "identity"}}, warningsInclude=["colour_converted_to_luminance"])})

    # ---- 46-48, 52: JPEG flavours and codecs that must fail closed with an actionable message
    def sof_stream(marker, precision, r_, c_):
        sof = struct.pack(">BHHB", precision, r_, c_, 1) + bytes([1, 0x11, 0])
        return b"\xFF\xD8\xFF" + bytes([marker]) + struct.pack(">H", 2 + len(sof)) + sof + b"\xFF\xD9"
    for name, ts, stream, reason, label in (
            ("f46_jpeg_extended_12bit.dcm", "1.2.840.10008.1.2.4.51", sof_stream(0xC1, 12, ROWS, COLS), "jpeg_12bit_lossy_unsupported", "12-bit lossy JPEG (4.51, SOF1 P=12)"),
            ("f48_jpeg_ls.dcm", "1.2.840.10008.1.2.4.80", b"\xFF\xD8\xFF\xF7\x00\x0b\x0c\x00\x60\x00\x80\x01\x01\x11\x00\xFF\xD9", "jpeg_ls_unsupported", "JPEG-LS (4.80)"),
            ("f52_jpeg_arithmetic.dcm", "1.2.840.10008.1.2.4.57", sof_stream(0xCB, 12, ROWS, COLS), "jpeg_arithmetic_unsupported", "arithmetic-coded lossless JPEG (SOF11)")):
        save_raw(name, file_meta(ts, n=46) + dataset(ROWS, COLS, stored=12, n=46) + encapsulated([[stream]]))
        add_case(file=name, ok=False, reason=reason, label=label + " fails closed", expect={"gray8": None, "rows": ROWS}, messageIncludes="Re-export")
    name = "f47_jpeg2000.dcm"
    j2 = gradient_image(ROWS, COLS, 4095, 4000, seed=47)
    buf = io.BytesIO()
    Image.fromarray(j2.astype(np.uint16)).save(buf, "JPEG2000", irreversible=False, no_jp2=True)
    save_raw(name, file_meta("1.2.840.10008.1.2.4.90", n=47) + dataset(ROWS, COLS, stored=12, n=47, extra=ORIENT_AP) + encapsulated([[buf.getvalue()]]))
    add_case(file=name, ok=False, reason="jpeg2000_unsupported", label="JPEG 2000 lossless (4.90, OpenJPEG codestream) fails closed",
             expect={"gray8": None, "rows": ROWS, "orientation": {"viewPosition": "AP"}}, messageIncludes="Re-export")

    # ---- 49: Rows written as DS "12.5" (non-integer geometry)
    name = "f49_rows_ds_fraction.dcm"
    body = (el(0x0008, 0x0060, "CS", "DX") + el(0x0028, 0x0004, "CS", "MONOCHROME2") + el(0x0028, 0x0010, "DS", "12.5") +
            el(0x0028, 0x0011, "US", u16s(10)) + el(0x0028, 0x0100, "US", u16s(8)) + el(0x7FE0, 0x0010, "OB", bytes(200)))
    save_raw(name, file_meta(TS_EXPL, n=49) + body)
    add_case(file=name, ok=False, reason="dimensions_invalid", label="Rows as DS 12.5", expect={"gray8": None, "rows": 12.5})

    # ---- 50: PALETTE COLOR stays refused
    name = "f50_palette_color.dcm"
    save_raw(name, file_meta(TS_EXPL, sop=SOP_SC, n=50) + dataset(ROWS, COLS, photometric="PALETTE COLOR", bits=8, modality="OT", sop=SOP_SC, n=50) +
             native_px(gradient_image(ROWS, COLS, 255, 200, seed=50).astype(np.uint8)))
    add_case(file=name, ok=False, reason="photometric_unsupported", label="PALETTE COLOR is refused", expect={"gray8": None})

    # ---- 51: Encapsulated Uncompressed Explicit VR LE (1.2.840.10008.1.2.1.98)
    name = "f51_encapsulated_uncompressed.dcm"
    img = gradient_image(ROWS, COLS, 4095, 3000, seed=51)
    save_raw(name, file_meta("1.2.840.10008.1.2.1.98", n=51) + dataset(ROWS, COLS, stored=12, n=51) +
             encapsulated([[img.astype("<u2").tobytes()]]))
    c, w = auto_window(img, 1, 0)
    add_codec_case(name, img, window_to_gray8(img, c, w), label="Encapsulated Uncompressed Explicit VR LE (1.2.1.98)",
                   expect={"pixelCodec": "encapsulated_uncompressed"}, noWarnings=True)


TS_JPEG_LL = "1.2.840.10008.1.2.4.70"


def refresh_without_pydicom():
    """Keeps the committed f01-f20 cases, recomputes those whose behaviour changed
    and regenerates f21+."""
    global expected
    path = os.path.join(FIX, "expected.json")
    old = json.load(open(path))
    fresh = {"f05_jpeg_lossless.dcm": expect_f05, "f06_multiframe.dcm": expect_f06, "f07_rgb.dcm": expect_f07,
             "f16_voilut_only.dcm": expect_f16, "f17_deflated.dcm": expect_f17}
    def legacy(f):
        return not (f[:1] == "f" and f[1:3].isdigit() and int(f[1:3]) >= 21)
    kept = [fresh[c["file"]]() if c["file"] in fresh else c for c in old if legacy(c["file"])]
    expected = kept
    codec_fixtures()
    # keep the real sample last, as the pydicom path does
    expected.sort(key=lambda c: (c["file"] == "test.dcm", c["file"]))


# ----------------------------------------------------------------------------
# Real-world sample (downloaded separately as fixtures/test.dcm)
# ----------------------------------------------------------------------------
def real_sample():
    path = os.path.join(FIX, "test.dcm")
    if not os.path.exists(path):
        print("test.dcm not present; skipping real sample")
        return
    data = open(path, "rb").read(200)
    if data.startswith(b"version https://git-lfs"):
        print("test.dcm is a Git LFS pointer; skipping real sample")
        return
    t = time.time()
    ds = pydicom.dcmread(path)
    arr = ds.pixel_array
    load_ms = (time.time() - t) * 1000
    ts = str(ds.file_meta.TransferSyntaxUID)
    case = dict(file="test.dcm", label="real-world sample (SpineForgePlanner test.dcm)", real=True,
                expect={"transferSyntaxUID": ts, "modality": str(ds.get("Modality")), "rows": int(ds.Rows),
                        "columns": int(ds.Columns), "bitsAllocated": int(ds.BitsAllocated),
                        "photometric": str(ds.PhotometricInterpretation)},
                pydicomLoadMs=round(load_ms, 1), byteLength=os.path.getsize(path))
    if "PixelSpacing" in ds:
        case["expect"]["pixelSpacingMm"] = {"row": float(ds.PixelSpacing[0]), "col": float(ds.PixelSpacing[1]), "source": "PixelSpacing"}
    if "WindowCenter" in ds:
        wc = ds.WindowCenter
        ww = ds.WindowWidth
        wc = float(wc[0]) if ds["WindowCenter"].VM > 1 else float(wc)
        ww = float(ww[0]) if ds["WindowWidth"].VM > 1 else float(ww)
        case["expect"]["window"] = {"center": wc, "width": ww, "source": "tag"}
    uncompressed = ts in (ImplicitVRLittleEndian, ExplicitVRLittleEndian)
    mono = ds.PhotometricInterpretation in ("MONOCHROME1", "MONOCHROME2")
    frames = int(ds.get("NumberOfFrames", 1) or 1)
    if uncompressed and mono and ds.SamplesPerPixel == 1 and frames == 1 and ds.BitsAllocated in (8, 16):
        case["ok"] = True
        case["reason"] = None
        stored = arr.astype(np.int64)
        shift = int(ds.HighBit) + 1 - int(ds.BitsStored)
        stored = (stored >> shift) & ((1 << int(ds.BitsStored)) - 1)
        if int(ds.PixelRepresentation) == 1:
            sign = 1 << (int(ds.BitsStored) - 1)
            stored = np.where(stored & sign, stored - 2 * sign, stored)
        slope = float(ds.get("RescaleSlope", 1))
        intercept = float(ds.get("RescaleIntercept", 0))
        invert = ds.PhotometricInterpretation == "MONOCHROME1"
        fn = str(ds.get("VOILUTFunction", "LINEAR")).upper()
        if fn not in ("LINEAR", "LINEAR_EXACT"):
            fn = "LINEAR"
        if "WindowCenter" in ds and "WindowWidth" in ds and case["expect"]["window"]["width"] >= 1:
            c, w = case["expect"]["window"]["center"], case["expect"]["window"]["width"]
        else:
            c, w = auto_window(stored, slope, intercept)
        g1 = window_to_gray8(stored * slope + intercept, c, w, fn=fn, invert=invert)
        g2 = pydicom_gray8(ds, arr)
        if g2 is not None:
            case["pydicomMaxDiff"] = int(np.abs(g1.astype(int) - g2.astype(int)).max())
        case["gray8"] = write_gray("test.dcm", g1)
    else:
        case["ok"] = False
        case["reason"] = None  # any failure reason accepted; test only checks ok
    add_case(**case)
    print("real sample:", case["expect"], "pydicom load ms", round(load_ms, 1))


def main():
    if HAVE_PYDICOM:
        for fn in [fixture_01, fixture_02, fixture_03, fixture_04, fixture_05, fixture_06, fixture_07, fixture_08,
                   fixture_09, fixture_10, fixture_11, fixture_12, fixture_13, fixture_14, fixture_15, fixture_16,
                   fixture_17_20, codec_fixtures, real_sample]:
            fn()
            print("ok", fn.__name__)
    else:
        print("pydicom is not installed: keeping the committed f01-f20 files, refreshing the changed expectations and regenerating f21+")
        refresh_without_pydicom()
    with open(os.path.join(FIX, "expected.json"), "w") as f:
        json.dump(expected, f, indent=1)
    print("wrote", len(expected), "cases to fixtures/expected.json")


if __name__ == "__main__":
    main()
