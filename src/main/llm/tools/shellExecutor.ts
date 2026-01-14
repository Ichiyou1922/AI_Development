import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CommandResult {
    success: boolean;
    stdout?: string;
    stderr?: string;
    error?: string;
}

// 許可されたコマンドのホワイトリスト
const ALLOWED_COMMANDS: Record<string, RegExp> = {
    settings: /^gsettings\s+(get|set)\s+[\w.-]+\s+[\w.-]+/,
    notify: /^notify-send\s+/,
    xdgOpen: /^xdg-open\s+/,
    date: /^date$/,
    whoami: /^whoami$/,
};

export async function executeCommand(
    command: string,
    timeoutMs: number = 5000
): Promise<CommandResult> {
    console.log(`[ShellExecutor] Attemptinf: ${command}`);
    //ホワイトリストチェック！
    const isAllowed = Object.values(ALLOWED_COMMANDS).some(regex => regex.test(command));

    if (!isAllowed) {
        return {
            success: false,
            error: `Command not allowed: ${command.split(' ')[0]}`,
        };
    }

    console.log(`[ShellExecutor] Executing...`);

    try {
        const { stdout, stderr } = await execAsync(command, {
            timeout: timeoutMs,
            encoding: 'utf-8',
        });

        console.log(`[ShellExecutor] stdout: ${stdout}`);
        console.log(`[ShellExecutor] stderr: ${stderr}`);

        return {
            success: true,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
        };
    } catch (error) {
        console.log(`[ShellExecutor] Error:`, error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            error: message,
        };
    }
}