import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE_DIR = join(process.cwd(), 'assets', 'scripts', 'core');

function collectScriptFiles(dir: string): string[] {
    const entries = readdirSync(dir);
    const result: string[] = [];

    for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            result.push(...collectScriptFiles(fullPath));
        } else if (/\.(ts|tsx|js|mjs|cjs)$/i.test(entry)) {
            result.push(fullPath);
        }
    }

    return result;
}

describe('core 纯净度检查', () => {
    it('assets/scripts/core/ 下不允许引用 cc、Math.random() 或 wx./tt. 平台全局对象', () => {
        const files = collectScriptFiles(CORE_DIR);
        expect(files.length).toBeGreaterThan(0);

        const violations: string[] = [];
        const ccImportPattern = /(?:from\s+['"]cc(?:\/[^'"]*)?['"]|import\s+['"]cc(?:\/[^'"]*)?['"]|require\(\s*['"]cc(?:\/[^'"]*)?['"]\s*\))/;
        const forbiddenGlobalPattern = /\b(?:Math\.random\s*\(|wx\.[A-Za-z_$]|tt\.[A-Za-z_$])/;

        for (const file of files) {
            const content = readFileSync(file, 'utf8');
            const strippedComments = content
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/.*$/gm, '');
            if (ccImportPattern.test(strippedComments) || forbiddenGlobalPattern.test(strippedComments)) {
                violations.push(relative(process.cwd(), file));
            }
        }

        expect(violations).toEqual([]);
    });
});
