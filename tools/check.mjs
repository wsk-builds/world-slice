import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

function hasValidLocalCocosEnv() {
    const localTsconfig = join(root, 'temp', 'tsconfig.cocos.json');
    const localCcDecl = join(root, 'temp', 'declarations', 'cc.d.ts');
    if (!existsSync(localTsconfig) || !existsSync(localCcDecl)) {
        return false;
    }

    const ccDeclContent = readFileSync(localCcDecl, 'utf8');
    const match = ccDeclContent.match(/\/\/\/\s*<reference\s+path="([^"]+)"\s*\/>/);
    if (match && match[1]) {
        const refPath = resolve(join(root, 'temp', 'declarations'), match[1]);
        if (!existsSync(refPath)) {
            return false;
        }
    }
    return true;
}

const useLocal = hasValidLocalCocosEnv();
const tscArgs = useLocal
    ? ['tsc', '--noEmit']
    : ['tsc', '-p', '.cursor/tsconfig.cloud.json', '--noEmit'];

if (!useLocal) {
    console.log('[check] 未检测到本地 Cocos temp/ 声明，改用云端类型检查配置 (.cursor/tsconfig.cloud.json)');
}

const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(process.execPath, [tscBin, ...tscArgs.slice(1)], {
    stdio: 'inherit',
    cwd: root,
});

process.exit(result.status ?? 1);
