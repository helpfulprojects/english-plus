import * as vscode from "vscode";
import * as path from "path";

type CodeDefinition = {
  snippetString: vscode.SnippetString | undefined;
  replacement: string;
};

let definitionsMap: Map<string, CodeDefinition>;
const registeredProbiders = new Map<string, vscode.Disposable>();
let commentsStartWith = "";
const passOnResultSymbol = "_";

async function pickFile(
  label: string
): Promise<vscode.TextDocument | undefined> {
  const pickedFiles = await vscode.window.showOpenDialog({
    filters: {
      "All files (*.*)": ["*"],
    },
    canSelectFolders: false,
    canSelectFiles: true,
    canSelectMany: false,
    openLabel: label,
  });

  if (!pickedFiles || pickedFiles.length < 1) {
    return;
  }
  const pickedFile = pickedFiles[0];
  const textDocument = await vscode.workspace.openTextDocument(pickedFile);
  return textDocument;
}

function isLineAComment(line: vscode.TextLine) {
  return line.text.startsWith(
    commentsStartWith,
    line.firstNonWhitespaceCharacterIndex
  );
}

function getComments(
  document: vscode.TextDocument,
  startingLine: vscode.TextLine
) {
  let currentLine = startingLine;
  const comments: vscode.TextLine[] = [];
  while (isLineAComment(currentLine)) {
    comments.unshift(currentLine);
    if (currentLine.lineNumber - 1 < 0) {
      break;
    }
    currentLine = document.lineAt(currentLine.lineNumber - 1);
  }
  return comments;
}

function commentToReplacement(
  comment: vscode.TextLine,
  previousResult?: string
) {
  const argumentsIdentifier: string[] = [];
  let commentCleanup = initialLineCleanup(comment);
  const identifier = commentCleanup.replace(
    /\((.*?)\)/g,
    (_, argumentIdentifier) => {
      argumentsIdentifier.push(argumentIdentifier);
      return `()`;
    }
  );
  const definition = definitionsMap.get(identifier);
  if (!definition) {
    return;
  }
  let replacement = definition.replacement;
  if (definition.snippetString) {
    argumentsIdentifier.forEach((argument, index) => {
      if (argument == passOnResultSymbol && previousResult) {
        argument = previousResult;
      } else if (argument == passOnResultSymbol && !previousResult) {
        return;
      }
      replacement = replacement.replaceAll(`~(~${index}~)~`, argument);
    });
  }
  if (!replacement) {
    return;
  }
  return replacement;
}

function getReplacement(comments: vscode.TextLine[]) {
  let replacement: string | undefined;
  for (let i = 0; i < comments.length; i++) {
    if (replacement) {
      replacement = commentToReplacement(comments[i], replacement);
    } else {
      replacement = commentToReplacement(comments[i]);
    }
    if (!replacement) {
      return;
    }
    replacement = replacement.replace(commentsStartWith, "");
  }
  replacement =
    comments[0].text.substring(
      0,
      comments[0].firstNonWhitespaceCharacterIndex
    ) + replacement;
  return replacement;
}

function initialLineCleanup(line: vscode.TextLine) {
  let result = line.text.replace(/^[ \f\t\v]+/, "").replace(/[ \f\t\v]+$/, "");
  if (isLineAComment(line)) {
    result = result.replace(new RegExp(`${commentsStartWith} *`), "");
    result = commentsStartWith + result;
  }
  return result;
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "english-plus.openCodeFromTutorial",
      async (ignoreContextUriPath: boolean = false) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }

        for (let extension of vscode.extensions.all) {
          let packageJSON = extension.packageJSON;
          if (packageJSON.contributes && packageJSON.contributes.languages) {
            for (let language of packageJSON.contributes.languages) {
              if (language.configuration) {
                let configPath = path.join(
                  extension.extensionPath,
                  language.configuration
                );
                if (language.id == editor.document.languageId) {
                  const configForLanguage =
                    await vscode.workspace.openTextDocument(configPath);
                  const configJson = JSON.parse(configForLanguage.getText());
                  commentsStartWith = configJson.comments.lineComment;
                }
              }
            }
          }
        }

        if (!commentsStartWith) {
          throw "Current programming language not supported. Stay tuned for future updates. To increase the priority for adding this language, comment somewhere the lack of support.";
        }

        // Select file with code from tutorial
        const contextUriPath = context.globalState.get(
          editor.document.fileName
        );
        let tutorialCodeDocument: vscode.TextDocument | undefined;
        if (!contextUriPath || ignoreContextUriPath) {
          tutorialCodeDocument = await pickFile(
            "Select file with code from tutorial..."
          );
          if (!tutorialCodeDocument) {
            return;
          }
          context.globalState.update(
            editor.document.fileName,
            tutorialCodeDocument.uri.path
          );
        } else {
          tutorialCodeDocument = await vscode.workspace.openTextDocument(
            contextUriPath
          );
        }
        // Extract all the definitions from the file
        definitionsMap = new Map<string, CodeDefinition>();

        for (let line = 1; line < tutorialCodeDocument.lineCount; line++) {
          const previousLine = tutorialCodeDocument.lineAt(line - 1);
          const currentLine = tutorialCodeDocument.lineAt(line);
          //we are looking for two types lines
          //line with code and comment above it
          //line with a comment with a comment above it
          const isPreviousLineComment = isLineAComment(previousLine);
          const isCurrentLineComment = isLineAComment(currentLine);
          const isCurrentLineCode =
            !isCurrentLineComment && !currentLine.isEmptyOrWhitespace;
          if (!isPreviousLineComment) {
            continue;
          }

          let comment = initialLineCleanup(previousLine).toLowerCase();
          let replacement = initialLineCleanup(currentLine);

          let snippetString: vscode.SnippetString | undefined;
          let argCount = 0;
          if (isCurrentLineComment) {
            let definitionArguments: string[] = [];
            snippetString = new vscode.SnippetString(
              comment.replace(/\((.*?)\)/g, (match, argumentIdentifier) => {
                argCount++;
                definitionArguments.push(match);
                return `(\${${argCount}:${argumentIdentifier}})`;
              })
            );
            comment = comment.replace(/\((.*?)\)/g, (_) => {
              return `()`;
            });
            definitionArguments.forEach((argumentIdentifier, index) => {
              replacement = replacement.replaceAll(
                argumentIdentifier,
                "~(~" + index + "~)~"
              );
            });
            line++;
          } else if (isCurrentLineCode) {
            line++;
          } else {
            continue;
          }

          definitionsMap.set(comment, { snippetString, replacement });
        }

        if (registeredProbiders.has(editor.document.fileName)) {
          registeredProbiders.get(editor.document.fileName)?.dispose();
        }

        //Auto completion for writing in english plus
        let disposable = vscode.languages.registerInlineCompletionItemProvider(
          { pattern: editor.document.fileName },
          {
            async provideInlineCompletionItems(
              document,
              position,
              context,
              token
            ) {
              const currentLine = document.lineAt(position.line);
              const isCurrentLineComment = isLineAComment(currentLine);
              const lineTextLength = currentLine.text.substring(
                currentLine.firstNonWhitespaceCharacterIndex
              ).length;
              if (
                !isCurrentLineComment ||
                lineTextLength <= 1 ||
                position.character == 0
              ) {
                return;
              }
              let lineCompletions: vscode.InlineCompletionItem[] = [];
              definitionsMap.forEach((value, key) => {
                lineCompletions.push(
                  new vscode.InlineCompletionItem(
                    value.snippetString ? value.snippetString : key,
                    new vscode.Range(
                      position.line,
                      currentLine.firstNonWhitespaceCharacterIndex,
                      position.line,
                      currentLine.text.length
                    )
                  )
                );
              });
              return lineCompletions;
            },
          }
        );
        registeredProbiders.set(editor.document.fileName, disposable);
      }
    )
  );

  //Paste translation of a comment bellow it
  vscode.workspace.onDidChangeTextDocument((event) => {
    if (!registeredProbiders.has(event.document.fileName)) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const document = editor.document;
    const changedLineNumber = event.contentChanges[0].range.start.line;
    const emptyLineAbove = document.lineAt(changedLineNumber);
    const currentLine = document.lineAt(changedLineNumber + 1);
    //We are looking for when enter is pressed, line above is empty and line above that is a comment
    if (
      /\r\n|\r|\n/g.test(event.contentChanges[0].text) &&
      emptyLineAbove.isEmptyOrWhitespace &&
      currentLine.isEmptyOrWhitespace
    ) {
      const comments = getComments(
        document,
        document.lineAt(changedLineNumber - 1)
      );
      if (comments.length < 1) {
        return;
      }
      const replacement = getReplacement(comments);
      if (!replacement) {
        return;
      }

      editor.edit((editBuilder) => {
        editBuilder.replace(emptyLineAbove.range, replacement);
      });
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "english-plus.changeSourceFile",
      async () => {
        vscode.commands.executeCommand(
          "english-plus.openCodeFromTutorial",
          true
        );
      }
    )
  );
}

export function deactivate() {}
