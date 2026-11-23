"""Build the PCM-only Folio Kitten variant from the official pinned web bundle.
Usage: python tools/voices/prepare-sdk.py upstream.js dist/voices/en-v1/kitten.js
The exact full input fingerprint is mandatory; never apply to another revision.
"""
import hashlib,re,sys
from pathlib import Path
raw=Path(sys.argv[1]).read_bytes()
if hashlib.sha256(raw).hexdigest()!='6bbc1d35555d6c7f25dc9d69c9f870f5d436b6040a58240ab61c30d60126899c':raise ValueError('not reviewed Kitten SDK c846fe92')
s=raw.decode()
start=s.index('function Wg(k,n,f){');end=s.index('var Xg=class{',start)
removed=s[start:end]
assert 'wasm-media-encoders' in removed and 'data:application/wasm;base64,AGFzb' in removed
# The removed contiguous module is the MP3 library, its embedded LAME binary,
# and the SDK wrapper. Base64/WAV and the synthesis backend are separate.
s=s[:start]+"var Lw=class{static encode(){throw Error('Folio uses PCM audio only')}};"+s[end:]
old='trackGeneration(n,f,L){this.analytics.trackGeneration({selectedVoice:f,generation:n,sdkErrorCode:L})}'
assert s.count(old)==1
s=s.replace(old,'trackGeneration(){}').replace('https://kittenmlanalytics.com/v1/track','disabled:')
# No outbound generation event even if accidentally instantiated with analytics enabled.
assert 'wasm-media-encoders' not in s and 'data:application/wasm;base64,AGFzb' not in s and 'kittenmlanalytics.com' not in s
s='/*! Folio PCM-only variant of KittenML SDK c846fe92: removed MP3 encoder and disabled telemetry. See ../NOTICE.txt. */\n'+s
Path(sys.argv[2]).write_text(s)
