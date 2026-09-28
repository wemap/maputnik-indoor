import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { expression, type StylePropertySpecification, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import jsonToAst, { type ValueNode, type PropertyNode } from "json-to-ast";
import { jsonPathToPosition } from "./json-path-to-position";

const maputnikTheme = EditorView.theme({
  "&": {
    backgroundColor: "#181818",
    color: "#5a5a5a",
    fontSize: "9pt",
  },
  ".cm-content": {
    caretColor: "#a0a0a0",
  },
  ".cm-cursor": {
    borderLeftColor: "#a0a0a0",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "#313030 !important",
  },
  ".cm-activeLine": {
    backgroundColor: "#232323",
  },
  ".cm-gutters": {
    backgroundColor: "#141414",
    borderRight: "1px solid #222",
    color: "#5a5a5a",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#1e1e1e",
  },
  ".cm-matchingBracket": {
    color: "#ffffff",
    backgroundColor: "#3a3a3a",
  },
}, { dark: true });

const maputnikHighlight = HighlightStyle.define([
  { tag: tags.propertyName,          color: "#dcdcdc" },  // clés JSON
  { tag: tags.string,                color: "#a0a0a0" },  // strings valeurs
  { tag: tags.number,                color: "#ffffff" },  // nombres
  { tag: tags.bool,                  color: "#fab4aa" },  // true/false
  { tag: tags.null,                  color: "#fab4aa" },  // null
  { tag: tags.punctuation,           color: "#646464" },  // { } [ ] : ,
  { tag: tags.bracket,               color: "#646464" },
]);

export type LintType = "layer" | "style" | "expression" | "json";

type LinterError = {
  key: string | null;
  message: string;
};

function getDiagnosticsFromExpressionErrors(errors: LinterError[], ast: ValueNode | PropertyNode) {
  const diagnostics: Diagnostic[] = [];
  for (const error of errors) {
    const {key, message} = error;
    if (!key) {
      diagnostics.push({
        from: 0,
        to: ast.loc ? ast.loc.end.offset : 0,
        severity: "error",
        message: message,
      });
    } else {
      const path = key.replace(/^\[|\]$/g, "").split(/\.|[[\]]+/).filter(Boolean);
      const node = jsonPathToPosition(path, ast);
      if (!node) {
        console.warn("Something went wrong parsing error:", error);
        continue;
      }
      if (node.loc) {
        diagnostics.push({
          from: node.loc.start.offset,
          to: node.loc.end.offset,
          severity: "error",
          message: message,
        });
      }
    }
  }
  return diagnostics;
}

function createMaplibreLayerLinter() {
  return (view: EditorView) => {
    const text = view.state.doc.toString();

    try {
      // Parse the JSON. The jsonParseLinter will handle pure JSON syntax errors.
      const parsedJson = JSON.parse(text);
      const ast = jsonToAst(text);

      // Run the maplibre-gl-style-spec validator.
      const validationErrors = validateStyleMin({
        "version": 8,
        "name": "Empty Style",
        "metadata": {},
        "sources": {},
        "sprite": "",
        "glyphs": "https://example.com/glyphs/{fontstack}/{range}.pbf",
        "layers": [
          parsedJson
        ]
      });

      const linterErrors = validationErrors
        .filter(err => {
          // Remove missing 'layer source' errors, because we don't include them
          return !err.message.match(/^layers\[0\]: source ".*" not found$/);
        })
        .map(err => {
          // Remove the 'layers[0].' as we're validating the layer only here
          const errMessageParts = err.message.replace(/^layers\[0\]./, "").split(":");
          return {
            key: errMessageParts[0],
            message: errMessageParts[1],
          };
        });
      return getDiagnosticsFromExpressionErrors(linterErrors, ast);
    } catch {
      // The built-in JSON linter handles JSON parsing errors, so we don't need to report them again.
    }
    return [];
  };
}

function createMaplibreStyleLinter() {
  return (view: EditorView) => {
    const text = view.state.doc.toString();

    try {
      // Parse the JSON. The jsonParseLinter will handle pure JSON syntax errors.
      const parsedJson = JSON.parse(text);
      const ast = jsonToAst(text);

      // Run the maplibre-gl-style-spec validator.
      const validationErrors = validateStyleMin(parsedJson);
      const linterErrors = validationErrors.map(err => {
        return {
          key: err.message.split(":")[0],
          message: err.message,
        };
      });
      return getDiagnosticsFromExpressionErrors(linterErrors, ast);
    } catch {
      // The built-in JSON linter handles JSON parsing errors, so we don't need to report them again.
    }
    return [];
  };
}

function createMaplibreExpressionLinter(spec?: StylePropertySpecification) {
  return (view: EditorView) => {
    const text = view.state.doc.toString();
    const parsedJson = JSON.parse(text);
    const ast = jsonToAst(text);
    const out = expression.createExpression(parsedJson, spec);
    if (out?.result !== "error") {
      return [];
    }
    const errors = out.value;
    return getDiagnosticsFromExpressionErrors(errors, ast);
  };
}

export function createEditor(props: {
  parent: HTMLElement,
  value: string,
  lintType: LintType,
  onChange: (value: string) => void,
  onFocus: () => void,
  onBlur: () => void,
  spec?: StylePropertySpecification,
}): EditorView {
  let specificLinter: (view: EditorView) => Diagnostic[] = () => [];
  switch (props.lintType) {
    case "style":
      specificLinter = createMaplibreStyleLinter();
      break;
    case "layer":
      specificLinter = createMaplibreLayerLinter();
      break;
    case "expression":
      specificLinter = createMaplibreExpressionLinter(props.spec);
      break;
    case "json":
      specificLinter = () => [];
      break;
  }

  return new EditorView({
    doc: props.value,
    extensions: [
      basicSetup,
      json(),
      maputnikTheme,
      syntaxHighlighting(maputnikHighlight),
      new Compartment().of(EditorState.tabSize.of(2)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const doc = update.state.doc;
          const value = doc.toString();
          props.onChange(value);
        }
        if (update.focusChanged) {
          if (update.view.hasFocus) {
            props.onFocus();
          } else {
            props.onBlur();
          }
        }
      }),
      lintGutter(),
      linter((view: EditorView) => {
        const jsonErrors = jsonParseLinter()(view);
        if (jsonErrors.length > 0) {
          return jsonErrors;
        }
        return specificLinter(view);
      })
    ],
    parent: props.parent,
  });
}
