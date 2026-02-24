declare module "madge" {
    interface MadgeConfig {
        baseDir?: string | null;
        excludeRegExp?: RegExp[] | false;
        fileExtensions?: string[];
        includeNpm?: boolean;
        requireConfig?: string | null;
        webpackConfig?: string | null;
        tsConfig?: string | object | null;
        rankdir?: string;
        layout?: string;
        fontName?: string;
        fontSize?: string;
        backgroundColor?: string;
        nodeColor?: string;
        nodeShape?: string;
        nodeStyle?: string;
        noDependencyColor?: string;
        cyclicNodeColor?: string;
        edgeColor?: string;
        graphVizOptions?: Record<string, string> | false;
        graphVizPath?: string | false;
        dependencyFilter?: ((source: string, target: string) => boolean) | false;
    }

    interface MadgeInstance {
        obj: () => Record<string, string[]>;
        warnings: () => { skipped: string[] };
        circular: () => string[][];
        circularGraph: () => Record<string, string[]>;
        depends: (id: string) => string[];
        orphans: () => string[];
        leaves: () => string[];
        dot: () => Promise<string>;
        image: (imagePath: string, circular?: boolean) => Promise<string>;
        svg: () => Promise<string>;
    }

    function madge(
        path: string | string[] | Record<string, string[]>,
        config?: MadgeConfig,
    ): Promise<MadgeInstance>;

    export default madge;
}
