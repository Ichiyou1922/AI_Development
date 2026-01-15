declare module 'pixi-live2d-display/cubism4' {
    export class Live2DModel {
        static registerTicker(ticker: any): void;
        static from(source: string | any, options?: any): Promise<Live2DModel>;
        internalModel: any;
        motion(group: string, index?: number, priority?: number): Promise<void>;
        expression(name: string): Promise<void>;
        destroy(): void;

        // Allow any other properties
        [key: string]: any;
        static [key: string]: any;
    }
}
