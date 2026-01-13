import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

// read .env
dotenv.config();

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

function createWindow(): void {
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            nodeIntegration: false, // to disable Node.js integration in Renderer
            contextIsolation: true // separate Renderer and Preload
        },
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    mainWindow.webContents.openDevTools();
}

ipcMain.handle('send-message', async (_event, message: string) => {
    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            messages: [
                { role: 'user', content: message}
            ],
        });

        const content = response.content[0];
        if (content.type === 'text') {
            return { success: true, text: content.text};
        }
        return { success: false, error: 'Unexpected response type'};
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message: 'Unknown error';
        return { success: false, error: errorMessage };
    }
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
