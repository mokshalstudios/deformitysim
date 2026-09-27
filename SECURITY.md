# Security and privacy

DeformitySim runs entirely in the browser under a strict Content-Security-Policy
(`connect-src 'none'`, no workers, no WebAssembly, no eval) and makes no network requests.
Images and DICOM files never leave the device; DICOM identity tags are not read.

Please report security or privacy problems privately to the maintainers rather than in a
public issue — for example anything that would let a crafted case file, image or DICOM file
run script, break the CSP, cause data to leave the device, or expose identifiers in an
export. Include the build id shown on the intro screen, the browser, and a minimal file or
steps that reproduce it.

The optional PHP hosting package in `deploy/` has its own threat model and tests
(`deploy/DEPLOY.md`, `deploy/tests/run.php`).

This is research and education software and is not intended to process identifiable patient
data; follow your institution's rules for any images you load.
