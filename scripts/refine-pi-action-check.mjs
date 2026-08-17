import fs from "node:fs";

const path = "src/runtime/type-checker.ts";
let text = fs.readFileSync(path, "utf8");

const narrowedSet = `const TYPE_CORRECTNESS_CODES = new Set<number>([\n  2322, 2345, 2367,`;
const originalSet = `const TYPE_CORRECTNESS_CODES = new Set<number>([\n  2339, 2551,\n  2322, 2345, 2367,`;
if (!text.includes(narrowedSet)) throw new Error("Expected narrowed correctness set after base migration");
text = text.replace(narrowedSet, originalSet);

const setEnd = `]);\n\nlet nextCheckerId = 0;`;
const helper = `]);\n\nconst PI_CORE_ACTIONS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);\nconst PI_CORE_ACTION_LIST = [...PI_CORE_ACTIONS].map((action) => \`pi.\${action}\`).join(", ");\n\nconst unknownPiCoreActionErrors = (sourceFile: ts.SourceFile): FabricTypeError[] => {\n  const errors: FabricTypeError[] = [];\n  const visit = (node: ts.Node): void => {\n    let action: string | undefined;\n    let nameNode: ts.Node | undefined;\n    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "pi") {\n      action = node.name.text;\n      nameNode = node.name;\n    } else if (\n      ts.isElementAccessExpression(node) &&\n      ts.isIdentifier(node.expression) &&\n      node.expression.text === "pi" &&\n      node.argumentExpression &&\n      ts.isStringLiteralLike(node.argumentExpression)\n    ) {\n      action = node.argumentExpression.text;\n      nameNode = node.argumentExpression;\n    }\n    if (action && nameNode && !PI_CORE_ACTIONS.has(action)) {\n      const position = sourceFile.getLineAndCharacterOfPosition(nameNode.getStart(sourceFile));\n      errors.push({\n        line: Math.max(1, position.line),\n        column: position.character + 1,\n        message: \`Unknown Pi core action: pi.\${action}. Available actions: \${PI_CORE_ACTION_LIST}.\${\n          action === "exec" ? " Use pi.bash for shell commands." : ""\n        }\`,\n      });\n    }\n    ts.forEachChild(node, visit);\n  };\n  visit(sourceFile);\n  return errors;\n};\n\nlet nextCheckerId = 0;`;
if (!text.includes(setEnd)) throw new Error("Type checker insertion marker missing");
text = text.replace(setEnd, helper);

const errorMarker = `    });\n    if (errors.length > 0) return { errors };`;
const errorReplacement = `    });\n    errors.push(...unknownPiCoreActionErrors(this.#sourceFile));\n    if (errors.length > 0) return { errors };`;
if (!text.includes(errorMarker)) throw new Error("Type checker error merge marker missing");
text = text.replace(errorMarker, errorReplacement);
fs.writeFileSync(path, text);

const testPath = "tests/type-checker.test.ts";
let tests = fs.readFileSync(testPath, "utf8");
tests = tests.replace(
  `error.message.includes("Property 'exec' does not exist") || error.message.includes("'exec' does not exist")`,
  `error.message.includes("Unknown Pi core action: pi.exec") && error.message.includes("pi.bash")`,
);
fs.writeFileSync(testPath, tests);

console.log("Scoped unknown pi.* validation applied");
