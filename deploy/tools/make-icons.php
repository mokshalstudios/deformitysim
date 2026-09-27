<?php
declare(strict_types=1);

/**
 * Generates the PWA / home-screen icons without needing the GD extension,
 * which DreamHost's CLI PHP does not always enable. Writes straight into
 * htdocs/. Re-run only if you change the artwork.
 *
 *     php make-icons.php
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("CLI only.\n");
}

function png_chunk(string $type, string $data): string
{
    return pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data));
}

/** @param array<int,array{0:int,1:int,2:int}> $pixels row-major RGB */
function png_encode(int $w, int $h, array $rows): string
{
    $raw = '';
    for ($y = 0; $y < $h; $y++) {
        $raw .= "\x00"; // filter type 0 (None)
        $raw .= $rows[$y];
    }
    return "\x89PNG\r\n\x1a\n"
        . png_chunk('IHDR', pack('NNccccc', $w, $h, 8, 2, 0, 0, 0)) // 8-bit truecolour RGB
        . png_chunk('IDAT', gzcompress($raw, 9))
        . png_chunk('IEND', '');
}

function make_icon(int $size, string $path, bool $maskable): void
{
    // Art must sit inside the central safe zone on maskable icons, because the
    // launcher is free to crop the outer ring to any shape it likes.
    $inset = (int) round($size * ($maskable ? 0.24 : 0.15));
    $top   = $inset;
    $bot   = $size - $inset;
    $cx    = $size / 2;
    $amp   = ($bot - $top) * 0.17;
    $stroke = max(1.5, $size * 0.038);
    $node   = max(2.0, $size * 0.052);

    // Sample the spine curve densely; each sample is stamped as a soft disc.
    $curve = [];
    for ($i = 0; $i <= 400; $i++) {
        $p = $i / 400;
        $curve[] = [$cx + $amp * sin($p * M_PI * 2.0 - M_PI * 0.5), $top + ($bot - $top) * $p];
    }
    $nodes = [];
    for ($i = 0; $i <= 6; $i++) {
        $p = $i / 6;
        $nodes[] = [$cx + $amp * sin($p * M_PI * 2.0 - M_PI * 0.5), $top + ($bot - $top) * $p];
    }

    $rows = [];
    for ($y = 0; $y < $size; $y++) {
        $row = '';
        $t = $y / max(1, $size - 1);
        $bgR = 7 + 8 * $t;
        $bgG = 17 + 14 * $t;
        $bgB = 31 + 26 * $t;
        for ($x = 0; $x < $size; $x++) {
            $r = $bgR; $g = $bgG; $b = $bgB;

            // Nearest distance to the curve, then to a vertebral node.
            $dCurve = PHP_FLOAT_MAX;
            foreach ($curve as $pt) {
                $d = ($pt[0] - $x) ** 2 + ($pt[1] - $y) ** 2;
                if ($d < $dCurve) { $dCurve = $d; }
            }
            $dCurve = sqrt($dCurve);
            $dNode = PHP_FLOAT_MAX;
            foreach ($nodes as $pt) {
                $d = ($pt[0] - $x) ** 2 + ($pt[1] - $y) ** 2;
                if ($d < $dNode) { $dNode = $d; }
            }
            $dNode = sqrt($dNode);

            // Antialias with a one-pixel falloff at each edge.
            $aCurve = 1.0 - min(1.0, max(0.0, $dCurve - $stroke) / 1.5);
            $aNode  = 1.0 - min(1.0, max(0.0, $dNode - $node) / 1.5);

            if ($aCurve > 0) {   // #60a5fa
                $r += (96 - $r) * $aCurve; $g += (165 - $g) * $aCurve; $b += (250 - $b) * $aCurve;
            }
            if ($aNode > 0) {    // #bfdbfe
                $r += (191 - $r) * $aNode; $g += (219 - $g) * $aNode; $b += (254 - $b) * $aNode;
            }
            $row .= chr((int) max(0, min(255, round($r))))
                  . chr((int) max(0, min(255, round($g))))
                  . chr((int) max(0, min(255, round($b))));
        }
        $rows[$y] = $row;
    }

    file_put_contents($path, png_encode($size, $size, $rows));
    printf("wrote %s (%d bytes)\n", basename($path), (int) filesize($path));
}

$out = __DIR__ . '/../htdocs/';
make_icon(180, $out . 'icon-180.png', false);
make_icon(192, $out . 'icon-192.png', false);
make_icon(512, $out . 'icon-512.png', false);
make_icon(512, $out . 'icon-512-maskable.png', true);
echo "done\n";
