import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const localTsconfig = join(root, 'temp', 'tsconfig.cocos.json');
const cloudTsconfigPath = join(root, '.cursor', 'tsconfig.cloud.json');

function buildCloudEsbuildConfig() {
    let compilerOptions = {
        target: 'ES2015',
        experimentalDecorators: true,
        useDefineForClassFields: false,
    };

    if (existsSync(cloudTsconfigPath)) {
        try {
            const parsed = JSON.parse(readFileSync(cloudTsconfigPath, 'utf8'));
            if (parsed && parsed.compilerOptions) {
                compilerOptions = {
                    useDefineForClassFields: false,
                    ...parsed.compilerOptions,
                };
            }
        } catch {
            // 兜底使用内置最小编译选项
        }
    }

    return {
        tsconfigRaw: JSON.stringify({ compilerOptions }),
    };
}

export default existsSync(localTsconfig)
    ? {}
    : {
          esbuild: buildCloudEsbuildConfig(),
      };
