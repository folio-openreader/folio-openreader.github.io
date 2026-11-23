// Optional GitHub Contents transport. All requests are explicit, and the only
// accepted payload is a bounded, sealed Folio vault; decryption/merge are caller work.
const API = 'https://api.github.com';
export const GITHUB_SYNC_FILE = 'folio-sync-v1.json';
export const GITHUB_SEALED_LIMIT = 768 * 1024;
const MAX_CIPHERTEXT_BYTES = 512 * 1024 + 16;
const FILE_REPLY_LIMIT = Math.ceil(GITHUB_SEALED_LIMIT / 3) * 4 + 192 * 1024;
const META_LIMIT = 96 * 1024, LIST_LIMIT = 384 * 1024, WRITE_LIMIT = 192 * 1024;
const TIMEOUT_MS = 18_000;
const sha = /^[a-f0-9]{40}$/;
const vaultPattern = /^[a-f0-9]{32}$/;
const ownerPattern = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
const repoPattern = /^[a-z0-9][a-z0-9_.-]{0,99}$/i;
const tokenPattern = /^github_pat_[a-z0-9_]{20,240}$/i;
const branchPattern = /^[a-z0-9][a-z0-9._/-]{0,127}$/i;
const exactPattern = (pattern, x) => typeof x === 'string' && pattern.exec(x)?.[0] === x;
const jsonObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
const messages = Object.freeze({
  'bad-target': 'Enter a simple GitHub owner and repository name.',
  'bad-token': 'Use a fine-grained GitHub token for the selected repository.',
  'not-active': 'Verify the private repository before syncing.',
  'disconnected': 'The GitHub connection is locked.',
  'busy': 'A GitHub sync operation is already running.',
  'canceled': 'The GitHub sync operation was stopped.',
  'network': 'The GitHub request failed. Local data was kept.',
  'repo-unverified': 'Could not verify access to the specified private repository.',
  'repo-not-private': 'Use a dedicated private repository. No vault data was uploaded.',
  'repo-changed': 'The verified repository or its default branch changed. Reconnect before syncing.',
  'repo-read-only': 'Use an active, initialized private repository.',
  'remote-disappeared': 'A previously known remote vault is now missing. Nothing was recreated.',
  'missing-unverified': 'GitHub did not confirm that the vault file is missing. Nothing was created.',
  'invalid-remote': 'GitHub returned an invalid or unsupported vault response.',
  'invalid-envelope': 'Folio requires a valid encrypted vault envelope.',
  'wrong-vault': 'This ciphertext belongs to a different vault. Nothing was uploaded.',
  'size-limit': 'The encrypted vault or GitHub reply is too large.',
  'unauthorized': 'The GitHub token was rejected or expired.',
  'forbidden': 'The token or repository policy does not allow this operation.',
  'rate-limited': 'GitHub limited requests. Wait before syncing again.',
  'quota': 'The storage operation exceeded a limit.',
  'not-observed': 'Read the current vault before trying to write.',
  'create-not-confirmed': 'Creating a new remote vault requires explicit confirmation after reading.',
  'stale-revision': 'The remote vault changed. Read and merge it again before writing.',
  'write-conflict': 'GitHub reported a conflict without a verified newer revision.',
  'write-rejected': 'GitHub rejected the write. No retry was made.',
  'write-unknown': 'Folio could not confirm the write. Read the remote vault before trying again.',
});

export class GithubSyncError extends Error {
  constructor(code) {
    super(messages[code]);
    this.name = 'GithubSyncError';
    this.code = code;
  }
}
const fail = code => { throw new GithubSyncError(code); };

function branchName(name) {
  return exactPattern(branchPattern,name) &&
    !name.includes('..') && !name.split('/').some(part => !part || part.startsWith('.') || /\.$|\.lock$/i.test(part));
}
function boundedInt(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function canonicalBase64Url(s, min, max) {
  if (typeof s !== 'string' || s.length > Math.ceil(max * 4 / 3) || !exactPattern(/^[A-Za-z0-9_-]+$/,s)) return false;
  const bytes = Math.floor(s.length * 3 / 4), rem = s.length % 4, last = s.at(-1);
  return rem !== 1 && bytes >= min && bytes <= max &&
    (rem !== 2 || /[AQgw]/.test(last)) && (rem !== 3 || /[AEIMQUYcgkosw048]/.test(last));
}
function sealedOnly(text, invalidCode) {
  if (typeof text !== 'string' || !text || text.length > GITHUB_SEALED_LIMIT) fail('size-limit');
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail(invalidCode); }
  if (!jsonObject(parsed) || Object.keys(parsed).length !== 6 ||
      !['format','version','alg','vault','iv','ciphertext'].every(k => Object.hasOwn(parsed,k)) ||
      parsed.format !== 'folio-sync' || parsed.version !== 1 || parsed.alg !== 'A256GCM' ||
      !exactPattern(vaultPattern,parsed.vault) ||
      !canonicalBase64Url(parsed.iv, 12, 12) ||
      !canonicalBase64Url(parsed.ciphertext, 17, MAX_CIPHERTEXT_BYTES)) fail(invalidCode);
  // Send only canonical fields; duplicate JSON keys/whitespace cannot carry
  // unauthenticated data. Authentication and the inner fields are vault work.
  const {format,version,alg,vault,iv,ciphertext} = parsed;
  const sealed = JSON.stringify({format,version,alg,vault,iv,ciphertext});
  if (sealed !== text) fail(invalidCode);
  return {sealed,vault};
}

async function readJson(response, cap, invalidCode) {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > cap) {
    if (response.body) void response.body.cancel().catch(() => {});
    fail('size-limit');
  }
  if (!response.body?.getReader) fail(invalidCode);
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8',{fatal:true});
  let data = '', bytes = 0, complete = false;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) { complete = true; break; }
      bytes += value.byteLength;
      if (bytes > cap) fail('size-limit');
      data += decoder.decode(value,{stream:true});
    }
    data += decoder.decode();
    return JSON.parse(data);
  } catch (error) {
    if (error instanceof GithubSyncError) throw error;
    fail(invalidCode);
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function bodyOfFile(value) {
  if (typeof value !== 'string') fail('invalid-remote');
  const b64 = value.replace(/[\r\n]/g,'');
  if (b64.length % 4 !== 0 || !exactPattern(/^[A-Za-z0-9+/]+={0,2}$/,b64)) fail('invalid-remote');
  if (b64.length * 3 / 4 - (b64.endsWith('==')?2:b64.endsWith('=')?1:0) > GITHUB_SEALED_LIMIT) fail('size-limit');
  try {
    const binary = atob(b64);
    if (btoa(binary) !== b64) fail('invalid-remote');
    if (binary.length > GITHUB_SEALED_LIMIT) fail('size-limit');
    return binary;
  } catch (error) {
    if (error instanceof GithubSyncError) throw error;
    fail('invalid-remote');
  }
}
const exactStatus = (response, status) => response.status === status;

export function createGithubSync({owner,repo,token,vaultId,expectedRepoId,expectExisting=false,fetcher=globalThis.fetch}={}) {
  if (!exactPattern(ownerPattern,owner) || owner.includes('--') || !exactPattern(repoPattern,repo)) fail('bad-target');
  if (!exactPattern(tokenPattern,token) || typeof fetcher !== 'function') fail('bad-token');
  if (!exactPattern(vaultPattern,vaultId)) fail('wrong-vault');
  if (expectedRepoId !== undefined && !boundedInt(expectedRepoId,1,Number.MAX_SAFE_INTEGER)) fail('bad-target');
  if (typeof expectExisting !== 'boolean') fail('bad-target');
  const repoPath = '/repos/' + owner + '/' + repo;
  const rootUrl = new URL(repoPath, API).href;
  const pathUrl = new URL(repoPath + '/contents/' + GITHUB_SYNC_FILE, API).href;
  const dirUrl = new URL(repoPath + '/contents', API).href;
  const identity = (owner + '/' + repo).toLowerCase();
  let bound = null, observed = null, active = null, seenRemote = expectExisting;
  function disconnect() {
    token = '';
    bound = observed = null;
    active?.abort();
  }
  function check(signal, writing=false) {
    if (!token) fail(writing ? 'write-unknown' : 'disconnected');
    if (signal.aborted) fail(writing ? 'write-unknown' : 'canceled');
  }
  async function run(signal, task) {
    if (!token) fail('disconnected');
    if (active) fail('busy');
    const controller = new AbortController(), abort = () => controller.abort();
    active = controller;
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort',abort,{once:true});
    const timer = setTimeout(abort,TIMEOUT_MS);
    try {
      check(controller.signal);
      return await task(controller.signal);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort',abort);
      active = null;
    }
  }
  function withRef(url, branch) {
    const target = new URL(url);
    target.searchParams.set('ref',branch);
    return target.href;
  }
  async function request(url, signal, body) {
    const writing = body !== undefined;
    check(signal);
    let response;
    try {
      response = await fetcher(url,{
        method:writing?'PUT':'GET',mode:'cors',credentials:'omit',redirect:'error',
        referrerPolicy:'no-referrer',cache:'no-store',signal,
        headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,...(writing?{'Content-Type':'application/json'}:{})},
        ...(writing?{body:JSON.stringify(body)}:{})
      });
    } catch {
      check(signal,writing);
      fail(writing?'write-unknown':'network');
    }
    check(signal,writing);
    // Production fetch supplies an absolute URL; the test fetcher may return
    // synthetic Responses without one. Even mocked redirects cannot proceed.
    if (!response?.headers?.get || response.redirected || response.type === 'opaqueredirect' || (response.url && response.url !== url)) {
      fail(writing?'write-unknown':'network');
    }
    if (response.status === 401) fail('unauthorized');
    if (response.status === 429 || (response.status === 403 &&
        (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) fail('rate-limited');
    if (response.status === 403) fail('forbidden');
    if (response.status === 413) fail('size-limit');
    if (response.status === 507) fail('quota');
    return response;
  }
  async function json(reply,cap,errorCode,signal) {
    try { return await readJson(reply,cap,errorCode); }
    catch(error) {
      check(signal,errorCode === 'write-unknown');
      throw error;
    }
  }
  async function verify(signal) {
    const reply = await request(rootUrl,signal);
    if (!exactStatus(reply,200)) fail('repo-unverified');
    const data = await json(reply,META_LIMIT,'repo-unverified',signal);
    check(signal);
    if (!jsonObject(data) || !boundedInt(data.id,1,Number.MAX_SAFE_INTEGER) ||
        typeof data.full_name !== 'string' || data.full_name.toLowerCase() !== identity ||
        !branchName(data.default_branch)) fail('repo-unverified');
    if (data.private !== true || data.visibility !== 'private') fail('repo-not-private');
    if (data.fork !== false || data.archived !== false || data.disabled !== false) fail('repo-read-only');
    if ((expectedRepoId !== undefined && expectedRepoId !== data.id) ||
        (bound && (bound.id !== data.id || bound.branch !== data.default_branch))) fail('repo-changed');
    return {id:data.id,branch:data.default_branch};
  }
  async function readVerified(signal) {
    const target = await verify(signal);
    const reply = await request(withRef(pathUrl,target.branch),signal);
    if (exactStatus(reply,404)) {
      // Repository metadata read alone does not prove Contents access. A
      // bounded same-branch directory listing confirms readable absence.
      const root = await request(withRef(dirUrl,target.branch),signal);
      if (!exactStatus(root,200)) fail('missing-unverified');
      const listing = await json(root,LIST_LIMIT,'missing-unverified',signal);
      check(signal);
      if (!Array.isArray(listing) || listing.length >= 1000 ||
          listing.some(entry => !jsonObject(entry) || typeof entry.path !== 'string' ||
            entry.path.toLowerCase() === GITHUB_SYNC_FILE)) fail('missing-unverified');
      if (seenRemote) fail('remote-disappeared');
      return {kind:'missing'};
    }
    if (!exactStatus(reply,200)) fail('invalid-remote');
    const data = await json(reply,FILE_REPLY_LIMIT,'invalid-remote',signal);
    check(signal);
    if (!jsonObject(data) || data.type !== 'file' || data.path !== GITHUB_SYNC_FILE ||
        data.encoding !== 'base64' || !exactPattern(sha,data.sha)) fail('invalid-remote');
    if (!boundedInt(data.size,1,GITHUB_SEALED_LIMIT)) fail('size-limit');
    const binary = bodyOfFile(data.content);
    if (binary.length !== data.size) fail('invalid-remote');
    const value = sealedOnly(binary,'invalid-remote');
    if (vaultId !== value.vault) fail('wrong-vault');
    seenRemote = true;
    return {kind:'found',sealed:value.sealed,revision:data.sha,vault:value.vault};
  }

  return Object.freeze({
    activate({signal}={}) {
      return run(signal,async localSignal => {
        observed = null;
        bound = await verify(localSignal);
        return {...bound};
      });
    },
    read({signal}={}) {
      return run(signal,async localSignal => {
        if (!bound) fail('not-active');
        observed = null;
        const value = await readVerified(localSignal);
        observed = value;
        const {vault: _vault,...result} = value;
        return result;
      });
    },
    write(sealed,{revision,allowCreate=false,signal}={}) {
      return run(signal,async localSignal => {
        if (!bound) fail('not-active');
        const value = sealedOnly(sealed,'invalid-envelope');
        if (!observed) fail('not-observed');
        const replacing = observed.kind === 'found';
        if (!replacing && (allowCreate !== true || revision != null)) fail('create-not-confirmed');
        if (replacing && (revision !== observed.revision || allowCreate)) fail('not-observed');
        const expectedVault = replacing ? observed.vault : vaultId;
        if (value.vault !== expectedVault) fail('wrong-vault');
        const previous = observed;
        observed = null; // require another positive read after any network attempt
        const target = await verify(localSignal);
        const reply = await request(pathUrl,localSignal,{
          message:'Update encrypted Folio vault',content:btoa(value.sealed),branch:target.branch,
          ...(replacing?{sha:revision}:{})
        });
        if ([409,412,422].includes(reply.status)) {
          // Confirm stale SHA by a read only. Never retry or merge on behalf of
          // the caller, and treat disappearing previously known files as unsafe.
          const latest = await readVerified(localSignal);
          if (latest.kind === 'found' && latest.vault !== value.vault) fail('wrong-vault');
          if (latest.kind === 'found' && (previous.kind === 'missing' || latest.revision !== previous.revision)) {
            fail('stale-revision');
          }
          fail(reply.status === 422 ? 'write-rejected' : 'write-conflict');
        }
        if (!exactStatus(reply,replacing?200:201)) fail(reply.status >= 500 || (reply.status >= 200 && reply.status < 300) ? 'write-unknown' : 'write-rejected');
        let payload;
        try { payload = await json(reply,WRITE_LIMIT,'write-unknown',localSignal); }
        catch { fail('write-unknown'); }
        check(localSignal,true);
        if (!jsonObject(payload) || payload.content?.path !== GITHUB_SYNC_FILE ||
            !exactPattern(sha,payload.content.sha)) fail('write-unknown');
        seenRemote = true;
        return {revision:payload.content.sha};
      });
    },
    disconnect,
  });
}
