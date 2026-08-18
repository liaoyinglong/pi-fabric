import path from "node:path";
import ts from "typescript";

export interface FabricTypeError {
  line: number;
  column: number;
  message: string;
}

export interface FabricTypeCheckResult {
  errors: FabricTypeError[];
  javascript?: string;
  sourceMap?: string;
}

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: false,
  noImplicitAny: false,
  strictNullChecks: false,
  strictFunctionTypes: false,
  strictBindCallApply: false,
  alwaysStrict: false,
  strictPropertyInitialization: false,
  noImplicitThis: false,
  useUnknownInCatchVariables: false,
  noEmit: false,
  sourceMap: true,
  skipLibCheck: true,
  lib: ["lib.es2022.d.ts"],
};

const TYPE_CORRECTNESS_CODES = new Set<number>([
  2339, 2551,
  2322, 2345, 2367,
  2531, 2532, 18047, 18048,
  7006, 7008, 7019, 7031, 7032, 7033, 7034,
]);

const shouldKeepSemanticDiagnostic = (diagnostic: ts.Diagnostic): boolean => {
  if (!TYPE_CORRECTNESS_CODES.has(diagnostic.code)) return true;
  if (diagnostic.code !== 2339 && diagnostic.code !== 2551) return false;
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  return /does not exist on type 'string'/.test(message);
};

const PI_CORE_ACTIONS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
const PI_CORE_ACTION_LIST = [...PI_CORE_ACTIONS].map((action) => `pi.${action}`).join(", ");
const REMOVED_ORCHESTRATION_GLOBALS = [
  "agents",
  "workflow",
  "agent",
  "parallel",
  "pipeline",
  "phase",
  "log",
  "budget",
  "__fabricTokenBudget",
] as const;
const GUEST_BOUNDARY_CLEANUP =
  `for (const __name of ${JSON.stringify(REMOVED_ORCHESTRATION_GLOBALS)}) Reflect.deleteProperty(globalThis, __name);`;

const memberName = (
  node: ts.Node,
  objectName: string,
): { action: string; nameNode: ts.Node } | undefined => {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === objectName) {
    return { action: node.name.text, nameNode: node.name };
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) && node.expression.text === objectName &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return { action: node.argumentExpression.text, nameNode: node.argumentExpression };
  }
  return undefined;
};

const unknownPiCoreActionErrors = (sourceFile: ts.SourceFile): FabricTypeError[] => {
  const errors: FabricTypeError[] = [];
  const visit = (node: ts.Node): void => {
    const member = memberName(node, "pi");
    if (member && !PI_CORE_ACTIONS.has(member.action)) {
      const position = sourceFile.getLineAndCharacterOfPosition(member.nameNode.getStart(sourceFile));
      errors.push({
        line: Math.max(1, position.line),
        column: position.character + 1,
        message: `Unknown Pi core action: pi.${member.action}. Available actions: ${PI_CORE_ACTION_LIST}.${
          member.action === "exec" ? " Use pi.bash for shell commands." : ""
        }`,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return errors;
};

let nextCheckerId = 0;

export const normalizeTypeScriptPath = (fileName: string): string =>
  fileName.replaceAll("\\", "/");

/**
 * The first wrapper line removes globals from retired orchestration features.
 * User code starts on wrapped line 2 so diagnostics and source maps keep their
 * existing coordinate contract.
 */
export const wrapFabricGuestCode = (code: string): string =>
  `async function __piFabricMain() { ${GUEST_BOUNDARY_CLEANUP}\n${code}\n}\n`;

class FabricTypeChecker {
  readonly #guestFile: string;
  readonly #declarationFile: string;
  readonly #baseHost = ts.createCompilerHost(compilerOptions, true);
  readonly #stableFiles = new Map<string, ts.SourceFile>();
  readonly #declarationSource: ts.SourceFile;
  readonly #host: ts.CompilerHost;
  #sourceText = "";
  #sourceFile: ts.SourceFile;
  #program: ts.Program | undefined;

  constructor(readonly declarations: string) {
    const id = ++nextCheckerId;
    this.#guestFile = normalizeTypeScriptPath(path.resolve(`/__pi_fabric_guest_${id}.ts`));
    this.#declarationFile = normalizeTypeScriptPath(path.resolve(`/__pi_fabric_globals_${id}.d.ts`));
    this.#sourceFile = ts.createSourceFile(this.#guestFile, "", ts.ScriptTarget.ES2022, true);
    this.#declarationSource = ts.createSourceFile(
      this.#declarationFile,
      declarations,
      ts.ScriptTarget.ES2022,
      true,
    );
    const isGuestFile = (fileName: string): boolean =>
      this.#baseHost.getCanonicalFileName(normalizeTypeScriptPath(fileName)) ===
      this.#baseHost.getCanonicalFileName(this.#guestFile);
    const isDeclarationFile = (fileName: string): boolean =>
      this.#baseHost.getCanonicalFileName(normalizeTypeScriptPath(fileName)) ===
      this.#baseHost.getCanonicalFileName(this.#declarationFile);
    this.#host = {
      ...this.#baseHost,
      fileExists: (fileName) =>
        isGuestFile(fileName) || isDeclarationFile(fileName) || this.#baseHost.fileExists(fileName),
      readFile: (fileName) => {
        if (isGuestFile(fileName)) return this.#sourceText;
        if (isDeclarationFile(fileName)) return this.declarations;
        return this.#baseHost.readFile(fileName);
      },
      getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
        if (isGuestFile(fileName)) return this.#sourceFile;
        if (isDeclarationFile(fileName)) return this.#declarationSource;
        const cached = this.#stableFiles.get(fileName);
        if (cached) return cached;
        const source = this.#baseHost.getSourceFile(
          fileName,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );
        if (source) this.#stableFiles.set(fileName, source);
        return source;
      },
    };
  }

  check(code: string): FabricTypeCheckResult {
    this.#sourceText = wrapFabricGuestCode(code);
    this.#sourceFile = ts.createSourceFile(this.#guestFile, this.#sourceText, ts.ScriptTarget.ES2022, true);
    const program = ts.createProgram({
      rootNames: [this.#declarationFile, this.#guestFile],
      options: compilerOptions,
      host: this.#host,
      ...(this.#program ? { oldProgram: this.#program } : {}),
    });
    this.#program = program;
    const diagnostics = [
      ...program.getSyntacticDiagnostics(this.#sourceFile),
      ...program.getSemanticDiagnostics(this.#sourceFile).filter(shouldKeepSemanticDiagnostic),
    ];
    const errors = diagnostics.map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (!diagnostic.file || diagnostic.start === undefined) return { line: 0, column: 0, message };
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return { line: Math.max(1, position.line), column: position.character + 1, message };
    });
    errors.push(...unknownPiCoreActionErrors(this.#sourceFile));
    if (errors.length > 0) return { errors };

    let javascript: string | undefined;
    let sourceMap: string | undefined;
    program.emit(this.#sourceFile, (fileName, content) => {
      if (fileName.endsWith(".js.map")) sourceMap = content;
      else if (fileName.endsWith(".js")) javascript = content;
    });
    return {
      errors,
      ...(javascript ? { javascript } : {}),
      ...(sourceMap ? { sourceMap } : {}),
    };
  }
}

const checkerCache = new Map<string, FabricTypeChecker>();
const MAX_CHECKERS = 4;

const checkerFor = (declarations: string): FabricTypeChecker => {
  const cached = checkerCache.get(declarations);
  if (cached) {
    checkerCache.delete(declarations);
    checkerCache.set(declarations, cached);
    return cached;
  }
  const checker = new FabricTypeChecker(declarations);
  checkerCache.set(declarations, checker);
  while (checkerCache.size > MAX_CHECKERS) {
    const oldest = checkerCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    checkerCache.delete(oldest);
  }
  return checker;
};

export interface FabricTranspileResult {
  code: string;
  sourceMap?: string;
}

export const transpileFabricCodeWithSourceMap = (code: string): FabricTranspileResult => {
  const result = ts.transpileModule(wrapFabricGuestCode(code), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
    },
  });
  return {
    code: result.outputText,
    ...(result.sourceMapText ? { sourceMap: result.sourceMapText } : {}),
  };
};

export const typeCheckFabricCode = (
  code: string,
  declarations: string,
): FabricTypeCheckResult => checkerFor(declarations).check(code);
