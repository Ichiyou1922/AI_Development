import { Tool, ToolResult } from './types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import * as os from 'os';

let ALLOWED_ROOT = os.homedir();
export function setAllowedRoot(path: string) { ALLOWED_ROOT = path; }

const resolveSafePath = async (targetPath: string): Promise<string | null> => {
    try {
        const absolutePath = path.resolve(ALLOWED_ROOT, targetPath);
        const realPath = await fs.realpath(absolutePath);
        const realRoot = await fs.realpath(ALLOWED_ROOT);
        
        if (!realPath.startsWith(realRoot)) {
            return null;
        }
        return realPath;
    } catch {
        return null;
    }
};

const searchFilesRecursively = async (dir: string, query: string): Promise<string[]> => {
    let results: string[] = [];
    try {
        const dirents = await fs.readdir(dir, { withFileTypes: true });
        for (const dirent of dirents) {
            const res = path.resolve(dir, dirent.name);
            
            // node_modules や .git などの巨大な隠しフォルダは無視する（パフォーマンス対策）
            if (dirent.name === 'node_modules' || dirent.name === '.git') continue;

            if (dirent.isDirectory()) {
                const subResults = await searchFilesRecursively(res, query);
                results = results.concat(subResults);
            } else {
                if (dirent.name.includes(query)) {
                    results.push(res);
                }
            }
        }
    } catch (e) {
        console.log(`[searchFileRecursively] Skipped: ${dir}`, e);
    }
    return results;
};

export const readFilePathTool: Tool = {
    definition: {
        name: 'read_file',
        description: '指定されたパスのファイル内容をテキストとして読み込む．ソースコードの確認やドキュメントの参照に使用する．',
        input_schema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: '読み込むファイルのパス'
                },
            },
            required: ['filePath'],
        },
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
        const filePath = input.filePath as string;
        const safePath = await resolveSafePath(filePath);

        if (!safePath) {
            return { success: false, error: 'アクセスが拒否されました'};
        }

        try {
            // テキストファイルとして読み込む
            const content = await fs.readFile(safePath, 'utf-8');
            return {
                success: true,
                result: `File: ${filePath}\n\n${content}`,
            };
        } catch (error: any) {
            return { success: false, error: `読み込み失敗: ${error.message}` };
        }
    },
};

export const listDirTool: Tool = {
    definition: {
        name: 'list_directory',
        description: '指定されたディレクトリ内のファイルとフォルダの一覧を取得する',
        input_schema: {
            type: 'object',
            properties: {
                dirPath: {
                    type: 'string',
                    description: '一覧を取得するディレクトリのパス（"."でルート）',
                },
            },
            required: ['dirPath'],
        },
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
        const dirPath = input.dirPath as string;
        const safePath = await resolveSafePath(dirPath);

        if (!safePath)  {
            return { success: false, error: 'アクセスが拒否されました' };
        }

        try {
            const dirents = await fs.readdir(safePath, { withFileTypes: true });

            const list = dirents.map(d => {
                const type = d.isDirectory() ? '[DIR]' : '[FILE]';
                return `${type} ${d.name}`;
            }).join('\n');

            return {
                success: true,
                result: `Directory: ${dirPath}\n\n${list}`,
            };
        } catch (error: any) {
            return { success: false, error: `一覧取得失敗: ${error.message}` };
        }
    },
};

export const searchFilesTool: Tool = {
    definition: {
        name: 'search_files',
        description: 'ファイル名でファイルを検索する（再帰的）．',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '検索するファイル名の一部' },
            },
            required: ['query'],
        },
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
        const query = input.query as string;
        try {
            const files = await searchFilesRecursively(ALLOWED_ROOT, query);
            // 結果が多すぎる場合の制限 (例: 50件)
            const limitedFiles = files.slice(0, 50);
            
            // UIに表示しやすいよう，ルートからの相対パスに変換して返す
            const resultList = limitedFiles.map(p => path.relative(ALLOWED_ROOT, p)).join('\n');
            
            return {
                success: true,
                result: `Found ${files.length} files (showing first 50):\n${resultList}`,
            };
        } catch (error: any) {
            return { success: false, error: `検索失敗: ${error.message}` };
        }
    },
};