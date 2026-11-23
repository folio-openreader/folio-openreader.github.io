import {mountSyncSettings} from './sync-settings.js';
import {createSyncController} from './sync-controller.js';
export {createWordStore} from './sync-local.js';
// Private QA only: tests may supply a mock adapter. Published UI never accepts a PAT in this build.
export function openSyncPanel(host,options){
  if(!host.ownerDocument.querySelector('link[data-folio-sync-style]')){
    const css=host.ownerDocument.createElement('link');css.rel='stylesheet';css.href=new URL('./sync-settings.css',import.meta.url).href;
    css.dataset.folioSyncStyle='';host.ownerDocument.head.append(css);
  }
  const hooks=createSyncController(options);
  if(!options.githubFactory)delete hooks.previewGithub;
  hooks.legacyReview=async()=>{const plan=await options.disk.legacyReview();
    return {kind:'merge',summary:{added:plan.added},apply:({signal})=>plan.apply(signal)}};
  return mountSyncSettings(host,hooks);
}
