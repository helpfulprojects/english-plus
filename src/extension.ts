import * as vscode from 'vscode';

let definitionsMap: Map<string,string>;

async function pickFile(label:string): Promise<vscode.TextDocument|undefined>{
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
        return
    }
    const pickedFile = pickedFiles[0];
    const textDocument = await vscode.workspace.openTextDocument(pickedFile);
    return textDocument
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('english-plus.openCodeFromTutorial', async (ignoreContextUriPath: boolean = false) => {
        const editor = vscode.window.activeTextEditor;
        if(!editor){
            return
        }
        const contextUriPath = context.globalState.get(editor.document.fileName)
        let tutorialCodeDocument: vscode.TextDocument | undefined;
        if(!contextUriPath || ignoreContextUriPath){
            tutorialCodeDocument = await pickFile("Select file with code from tutorial...");
            if(!tutorialCodeDocument){
                return
            }
            context.globalState.update(editor.document.fileName,tutorialCodeDocument.uri.path)
        }else{
            tutorialCodeDocument = await vscode.workspace.openTextDocument(contextUriPath);
        }
        definitionsMap = new Map<string,string>();
        const commentsStartWith = "#"

        for(let line = 1; line < tutorialCodeDocument.lineCount; line++){
            const previousLine = tutorialCodeDocument.lineAt(line-1) 
            const currentLine = tutorialCodeDocument.lineAt(line);
            //we are looking for two types lines
            //line with code and comment above it
            //line with a comment with a comment above it
            const isPreviousLineComment = previousLine.text.startsWith(commentsStartWith,previousLine.firstNonWhitespaceCharacterIndex)
            const isCurrentLineComment = currentLine.text.startsWith(commentsStartWith,currentLine.firstNonWhitespaceCharacterIndex)
            const isCurrentLineCode = !isCurrentLineComment && !currentLine.isEmptyOrWhitespace
            if(!isPreviousLineComment){
                continue;
            }
            let definition = previousLine.text.substring(previousLine.firstNonWhitespaceCharacterIndex)
            let replacement = currentLine.text.substring(currentLine.firstNonWhitespaceCharacterIndex)
            if(isCurrentLineComment){
                let definitionArguments: string[] = []
                let argumentsCount = 0;
                definition = definition.replace(/\((.*?)\)/g, (match,argumentIdentifier) => {
                    argumentsCount++;
                    definitionArguments.push(match)
                    return `(\${${argumentsCount}:${argumentIdentifier}})`;
                });
                definition = definition.toLowerCase()
                definitionArguments.forEach((argumentIdentifier, index) => {
                    replacement = replacement.replaceAll(argumentIdentifier, "~(~" + index + "~)~");
                });
                line++;
            }else if(isCurrentLineCode){
                line++;    
            }else{
                continue;
            }
            
            definitionsMap.set(definition, replacement);
            console.log(definitionsMap)
        }
	}));

    context.subscriptions.push(vscode.commands.registerCommand('english-plus.changeSourceFile', async () => {
        vscode.commands.executeCommand('english-plus.openCodeFromTutorial',true)
	}));

    //Inline completion for existing definitions. Comment with just code is added as regular text, comment with comment is added as snippet
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, {
        async provideInlineCompletionItems(document, position, context, token) {
			const regexp = /\/\/ \[(.+?),(.+?)\)(.*?):(.*)/;
			if (position.line <= 0) {
				return;
			}

			const result: vscode.InlineCompletionItem[] = [];

			let offset = 1;
			while (offset > 0) {
				if (position.line - offset < 0) {
					break;
				}
				
				const lineBefore = document.lineAt(position.line - offset).text;
				const matches = lineBefore.match(regexp);
				if (!matches) {
					break;
				}
				offset++;

				const start = matches[1];
				const startInt = parseInt(start, 10);
				const end = matches[2];
				const endInt =
					end === '*'
						? document.lineAt(position.line).text.length
						: parseInt(end, 10);
				const flags = matches[3];
				const completeBracketPairs = flags.includes('b');
				const isSnippet = flags.includes('s');
				const text = matches[4].replace(/\\n/g, '\n');

				result.push({
					insertText: isSnippet ? new vscode.SnippetString(text) : text,
					range: new vscode.Range(position.line, startInt, position.line, endInt)
				});
			}

			return result;
		}
    });
}

export function deactivate() {}
