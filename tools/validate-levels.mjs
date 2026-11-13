import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const rootDir = process.cwd();
const levelsDir = resolve(rootDir, process.argv[2] ?? join('assets', 'resources', 'levels'));

const moduleCache = new Map();

/** 在内存中用 TypeScript 编译器即时转译并加载纯 TS 模块（避免重复维护两套校验规则） */
function loadTsModule(filePath) {
    const absPath = resolve(filePath);
    if (moduleCache.has(absPath)) {
        return moduleCache.get(absPath).exports;
    }

    const source = readFileSync(absPath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        fileName: absPath,
        compilerOptions: {
            target: ts.ScriptTarget.ES2019,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
        },
        reportDiagnostics: false,
    });

    const mod = { exports: {} };
    moduleCache.set(absPath, mod);

    const localRequire = (specifier) => {
        if (!specifier.startsWith('.')) {
            return require(specifier);
        }
        const base = resolve(dirname(absPath), specifier);
        const candidates = [base, `${base}.ts`, `${base}.js`, join(base, 'index.ts')];
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return candidate.endsWith('.ts') ? loadTsModule(candidate) : require(candidate);
            }
        }
        throw new Error(`无法解析模块引用: ${specifier} (来自 ${absPath})`);
    };

    const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${transpiled.outputText}\n})`;
    const fn = vm.runInThisContext(wrapped, { filename: absPath });
    fn(mod.exports, localRequire, mod, absPath, dirname(absPath));
    return mod.exports;
}

function main() {
    if (!existsSync(levelsDir)) {
        console.error(`[levels] 目录不存在: ${levelsDir}`);
        process.exit(1);
    }

    const files = readdirSync(levelsDir)
        .filter((name) => extname(name).toLowerCase() === '.json')
        .sort();

    if (files.length === 0) {
        console.error(`[levels] 未找到任何关卡 JSON 文件: ${levelsDir}`);
        process.exit(1);
    }

    const { validateLevel } = loadTsModule(join(rootDir, 'assets', 'scripts', 'core', 'level', 'validateLevel.ts'));
    const { getRingSpeciesKey } = loadTsModule(join(rootDir, 'assets', 'scripts', 'core', 'level', 'LevelData.ts'));

    let failedCount = 0;

    for (const file of files) {
        const fullPath = join(levelsDir, file);
        const relPath = relative(rootDir, fullPath);
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
        } catch (err) {
            failedCount++;
            console.error(`[levels] FAIL ${relPath}: JSON 解析失败 - ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }

        const result = validateLevel(parsed);
        const expectedId = file.slice(0, -'.json'.length);
        const errors = [...result.errors];
        if (result.level && result.level.id !== expectedId) {
            errors.push(`文件名 "${expectedId}" 与关卡 id "${result.level.id}" 不一致`);
        }

        if (errors.length > 0) {
            failedCount++;
            console.error(`[levels] FAIL ${relPath}:`);
            for (const msg of errors) {
                console.error(`  - ${msg}`);
            }
            continue;
        }

        const species = new Set(result.level.rings.map((r) => getRingSpeciesKey(r)));
        console.log(
            `[levels] OK   ${relPath} (${result.level.rings.length} 圈, ${species.size} 种, ${result.level.durationSec}s)`,
        );
    }

    if (failedCount > 0) {
        console.error(`[levels] 共 ${failedCount}/${files.length} 个关卡校验失败`);
        process.exit(1);
    }

    console.log(`[levels] 全部 ${files.length} 个关卡 JSON 校验通过`);
}

main();
