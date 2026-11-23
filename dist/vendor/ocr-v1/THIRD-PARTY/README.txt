Folio offline OCR: included third-party software, runtime and data
================================================================

This software is based in part on the work of the Independent JPEG Group.

The MIT license for Folio's own code does not relicense these assets. Keep
this folder and the sibling license, NOTICE and package metadata files with
the worker, both LSTM runtime variants (with/without SIMD), and language data.

The Tesseract.js 6.0.1 worker source map identifies nine included npm
dependencies. worker-*.txt are their preserved package license files.
../LICENSE-TesseractJS.txt supplies the full Apache License 2.0 where a
package contains only an Apache short notice. ../worker.min.js.LICENSE.txt
is the original minifier notice, not a substitute for these additional texts.

Native notices correspond to the nine submodule Git object pins for
Tesseract.js-core 6.1.2 (see SOURCES.json). Its Emscripten 3.1.38 toolchain
includes Emscripten runtime, musl/libc and socket code, dlmalloc, compiler-rt,
libc++ and libc++abi notices. This conservatively describes the build, not
a claim that every source/object in those projects survived dead-code
elimination. No exact per-object link map accompanies these stripped binaries.
Tests in openlibm are not a Folio-distributed test suite.

GlyphLessFont (pdf.ttf): Copyright 2020 Google Inc.; upstream header credited
to Zdenko Podobny. Apache License 2.0, see native-tesseract.txt. Both cores
expose the same 572-byte /pdf.ttf as the pinned upstream font. Retain the
source header and license. SHA-256:
c7845420925a23d88ed830a63957b8af85a66a8daf8d9fc90e843673b2ef1a59

Model data: the eng/rus/kaz 4.0.0_best_int model bytes are distributed by
@tesseract.js-data/{eng,rus,kaz} 1.0.0. jpn/jpn_vert/kor derive from
tessdata_fast tag 4.1.0, gzip-compressed for this app. See ../NOTICE.txt,
../LICENSE-Models.txt, ../LICENSE-Tessdata-Fast.txt and package metadata.
Source links, license payload checksums and artifact hashes: SOURCES.json.
