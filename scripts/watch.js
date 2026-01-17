
const esbuild = require('esbuild');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const electron = require('electron');

// 外部依存関係（package.jsonのbuild:mainから取得）
const external = [
    'electron',
    'better-sqlite3',
    '@anthropic-ai/sdk',
    'discord.js',
    '@discordjs/voice',
    '@discordjs/opus',
    'sodium-native',
    'prism-media',
    'mic',
    'speaker',
    'wav',
    'whisper-node',
    '@xenova/transformers'
];

let electronProcess = null;

// Electronを起動・再起動
function restartElectron() {
    if (electronProcess && electronProcess.pid) {
        // console.log('[Watch] Restarting Electron...');
        try {
            // プロセスグループごとkillしたいが、まずはSIGTERM
            process.kill(electronProcess.pid);
        } catch (e) {
            // すでに死んでいる場合など
        }
    } else {
        // console.log('[Watch] Starting Electron...');
    }

    // 少し待ってから起動（ポート開放待ちなど）
    setTimeout(() => {
        electronProcess = spawn(electron, ['.'], {
            stdio: 'inherit',
            env: { ...process.env }
        });

        electronProcess.on('close', (code) => {
            //意図せぬ終了の場合のログなど
        });
    }, 500);
}

// アセットのコピーを実行
function copyAssets() {
    try {
        // package.jsonのcopy-assets相当
        // mkdir -p dist/renderer && cp src/renderer/*.html src/renderer/*.css dist/renderer/ && cp -r src/renderer/lib dist/renderer/ && cp -r src/renderer/assets dist/renderer/
        execSync('npm run copy-assets', { stdio: 'ignore' });
        console.log('[Watch] Assets updated.');
    } catch (e) {
        console.error('[Watch] Failed to copy assets:', e);
    }
}

async function start() {
    console.log('[Watch] Starting build watcher...');

    // 初回アセットコピー
    copyAssets();

    // 1. Main Process
    const mainCtx = await esbuild.context({
        entryPoints: ['src/main/index.ts'],
        bundle: true,
        platform: 'node',
        outfile: 'dist/main/index.js',
        external,
        plugins: [{
            name: 'on-rebuild',
            setup(build) {
                build.onEnd(result => {
                    if (result.errors.length === 0) {
                        console.log('[Watch] Main process rebuilt.');
                        restartElectron();
                    }
                });
            }
        }]
    });

    // 2. Preload
    const preloadCtx = await esbuild.context({
        entryPoints: ['src/preload/index.ts'],
        bundle: true,
        platform: 'node',
        outfile: 'dist/preload/index.js',
        external: ['electron'],
        plugins: [{
            name: 'on-rebuild',
            setup(build) {
                build.onEnd(() => {
                    console.log('[Watch] Preload rebuilt. Reload the window (Ctrl+R) to update.');
                });
            }
        }]
    });

    // 3. Renderer (renderer.ts)
    const rendererCtx = await esbuild.context({
        entryPoints: ['src/renderer/renderer.ts'],
        bundle: true,
        outfile: 'dist/renderer/renderer.js',
        platform: 'browser',
        format: 'iife',
        external: ['electron'],
        plugins: [{
            name: 'on-rebuild',
            setup(build) {
                build.onEnd(() => {
                    console.log('[Watch] Renderer rebuilt. Reload the window (Ctrl+R) to update.');
                });
            }
        }]
    });

    // 4. Renderer (live2d.ts)
    const live2dCtx = await esbuild.context({
        entryPoints: ['src/renderer/live2d.ts'],
        bundle: true,
        outfile: 'dist/renderer/live2d.js',
        platform: 'browser',
        format: 'iife',
        plugins: [{
            name: 'on-rebuild',
            setup(build) {
                build.onEnd(() => console.log('[Watch] Live2D rebuilt.'));
            }
        }]
    });

    // 5. Renderer (mascot.ts)
    const mascotCtx = await esbuild.context({
        entryPoints: ['src/renderer/mascot.ts'],
        bundle: true,
        outfile: 'dist/renderer/mascot.js',
        platform: 'browser',
        format: 'iife',
        plugins: [{
            name: 'on-rebuild',
            setup(build) {
                build.onEnd(() => console.log('[Watch] Mascot rebuilt.'));
            }
        }]
    });

    // 6. 簡易的なアセット監視 (fs.watch)
    // src/renderer フォルダを監視して、html/cssが変わったらコピー
    try {
        fs.watch('src/renderer', { recursive: false }, (eventType, filename) => {
            if (filename && (filename.endsWith('.html') || filename.endsWith('.css'))) {
                copyAssets();
            }
        });
    } catch (e) {
        console.warn('Assets watch failed (platform limitation?):', e);
    }

    // ウォッチ開始
    await mainCtx.watch();
    await preloadCtx.watch();
    await rendererCtx.watch();
    await live2dCtx.watch();
    await mascotCtx.watch();

    // 最初の起動（Mainのビルド完了で起動するはずだが、念の為）
    // build.onEndは初回ビルド時にも呼ばれるので、ここでは何もしない。

    // プロセス終了時のクリーンアップ
    process.on('SIGINT', () => {
        if (electronProcess) process.kill(electronProcess.pid);
        process.exit();
    });
}

start();
