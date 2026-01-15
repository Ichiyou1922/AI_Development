declare module 'speaker' {
    interface SpeakerOptions {
        channel: number;
        bitDepth: number;
        sampleRate: number;
    }

    export interface Speaker {
        play(buffer: Buffer): void;
    }

    export function Speaker(options: SpeakerOptions): Speaker;
}   