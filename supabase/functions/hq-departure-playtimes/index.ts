export {createHandler} from './handler.mjs';
import {createHandler} from './handler.mjs';

if(typeof Deno!=='undefined') {
  const keys=['HQ_ORIGIN','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','GINGR_API_KEY','GINGR_SUBDOMAIN','GINGR_LOCATION_ID'];
  Deno.serve(createHandler({env:Object.fromEntries(keys.map(key=>[key,Deno.env.get(key)])),log:entry=>console.warn('hq-departure-playtimes',JSON.stringify(entry))}));
}
