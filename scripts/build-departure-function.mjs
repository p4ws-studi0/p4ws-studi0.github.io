// Build the same module sources into one Supabase Dashboard-compatible file.
// Usage: node scripts/build-departure-function.mjs /absolute/private/output/index.ts
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

const output=process.argv[2];
if(!output||!isAbsolute(output))throw new Error('Provide an absolute output path for the private deployment artifact.');
const root=new URL('../supabase/functions/hq-departure-playtimes/',import.meta.url);
const files=['domain.mjs','reader.mjs','adapter.mjs','handler.mjs','index.ts'];
const sources=await Promise.all(files.map(name=>readFile(new URL(name,root),'utf8')));
const hash=createHash('sha256').update(sources.join('\n')).digest('hex');
const noImports=source=>source.replace(/^import[^\n]*\n/gm,'');
const privateExports=source=>noImports(source).replace(/^export /gm,'');
const [domain,reader,adapter,handler,entry]=sources;
const runtimeStart=entry.indexOf("if(typeof Deno");
if(runtimeStart<0)throw new Error('The Edge runtime entry point changed; review the bundler.');
const runtime=entry.slice(runtimeStart);
const bundle=`// GENERATED: do not edit. Source SHA-256: ${hash}\n`+
  `import {createHash} from 'node:crypto';\n`+
  `const DOMAIN=(()=>{\n${privateExports(domain)}\nreturn {DomainError,normalizeSnapshot,easternDate,buildDailyView};\n})();\n`+
  `const PROVIDER=(()=>{\nconst {easternDate}=DOMAIN;\n${privateExports(reader)}\nreturn {createGingrReader};\n})();\n`+
  `const ADAPTER=(()=>{\nconst {DomainError,normalizeSnapshot,easternDate}=DOMAIN;\n${privateExports(adapter)}\nreturn {buildSource};\n})();\n`+
  `const {buildDailyView,easternDate}=DOMAIN;\nconst {createGingrReader}=PROVIDER;\nconst {buildSource}=ADAPTER;\n${noImports(handler)}\n${runtime}\n`;
if(/^import(?! \{createHash\} from 'node:crypto';)/m.test(bundle))throw new Error('Unexpected deployment import.');
await mkdir(dirname(output),{recursive:true,mode:0o700});
await writeFile(output,bundle,{mode:0o600});
process.stdout.write(`Generated ${output}\nSource SHA-256: ${hash}\n`);
