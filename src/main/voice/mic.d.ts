declare module 'mic' {
    interface MicOptions {
        rate?: string;
        channels?: string;
        bitwidth?: string;
        encoding?: string;
        endian?: string;
        device?: string;
        debug?: boolean;
        exitOnSilence?: number;
        fileType?: string;
    }

    interface MicInstance {
        getAudioStream(): NodeJS.ReadableStream;
        start(): void;
        stop(): void;
        pause(): void;
        resume(): void;
    }

    function mic(options?: MicOptions): MicInstance;

    export = mic;
}