/**
 * Shared types for the monorepo consistency CLI
 */

export type SeverityLevel = "low" | "medium" | "high" | "critical";
export type OutputFormat = "table" | "json" | "html" | "terminal";
export type ConfigType = "tsconfig" | "eslint" | "package-json";

export interface CommandOptions {
    cwd?: string;
    verbose?: boolean;
    silent?: boolean;
    noColor?: boolean;
    json?: boolean;
    dryRun?: boolean;
}

export interface CheckResult {
    success: boolean;
    issues: Issue[];
    stats: Stats;
}

export interface Issue {
    severity: SeverityLevel;
    type: string;
    package?: string;
    file?: string;
    message: string;
    fix?: string;
}

export interface Stats {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
}

export interface FixResult {
    success: boolean;
    applied: number;
    failed: number;
    changes: Change[];
}

export interface Change {
    type: string;
    package?: string;
    file?: string;
    description: string;
    before?: string;
    after?: string;
}

export interface ReportOptions extends CommandOptions {
    format?: OutputFormat;
    output?: string;
}

export interface WorkspaceInfo {
    root: string;
    packages: PackageInfo[];
    lockfile: string;
    workspaceFile: string;
}

export interface PackageInfo {
    name: string;
    path: string;
    version: string;
    private: boolean;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
}

export interface DomainHandler {
    check: (options: CommandOptions) => Promise<CheckResult>;
    fix: (options: CommandOptions) => Promise<FixResult>;
    report?: (options: ReportOptions) => Promise<void>;
}
