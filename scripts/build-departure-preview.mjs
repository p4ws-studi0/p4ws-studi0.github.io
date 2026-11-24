// Generate an unlisted preview from the production sources, without menu changes.
// Usage: node scripts/build-departure-preview.mjs /absolute/site/root
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,isAbsolute,join} from 'node:path';
const destination=process.argv[2];
if(!destination||!isAbsolute(destination))throw new Error('Provide an absolute output site root.');
const root=new URL('../',import.meta.url),base='/preview/departure-playtimes',folder=join(resolve(destination),'preview/departure-playtimes');
await mkdir(join(folder,'assets'),{recursive:true});
const source=await readFile(new URL('departure-playtimes.html',root),'utf8');
const html=source.replace('<title>','<meta name="robots" content="noindex,nofollow"><title>Preview · ')
  .replaceAll('/assets/departure-playtimes.css',`${base}/assets/page.css`)
  .replaceAll('/assets/departure-playtimes.js',`${base}/assets/page.js`)
  .replaceAll('/assets/departure-playtimes/',`${base}/assets/`)
  .replace('<main id="departurePlaytimesPage">','<main id="departurePlaytimesPage"><p style="margin:0 2px 16px;color:var(--muted);font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase">Preview · Not in the menu yet</p>');
await writeFile(join(folder,'index.html'),html);
const js=await readFile(new URL('assets/departure-playtimes.js',root),'utf8');
await writeFile(join(folder,'assets/page.js'),js.replaceAll('/assets/departure-playtimes/',`${base}/assets/`));
await copyFile(new URL('assets/departure-playtimes.css',root),join(folder,'assets/page.css'));
for(const icon of ['tlc','puppy','bronze','silver','gold'])await copyFile(new URL(`assets/departure-playtimes/${icon}.svg`,root),join(folder,`assets/${icon}.svg`));
process.stdout.write(`Generated unlisted preview: ${folder}\n`);
