import * as vscode from 'vscode';

let definitionsMap: Map<string,string>;
const commentsStartWith = "#"

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
        }

        //Inline completion for existing definitions. Comment with just code is added as regular text, comment with comment is added as snippet
        vscode.languages.registerInlineCompletionItemProvider({ pattern: editor.document.fileName }, {
            async provideInlineCompletionItems(document, position, context, token) {
                const currentLine = document.lineAt(position.line)
                const isCurrentLineComment = currentLine.text.startsWith(commentsStartWith,currentLine.firstNonWhitespaceCharacterIndex)
                const lineTextLength = currentLine.text.substring(currentLine.firstNonWhitespaceCharacterIndex).length
                if (!isCurrentLineComment || lineTextLength <= 1) {
                    return;
                }
                let definitionsKeys = Array.from( definitionsMap.keys() )
                let lineCompletions: vscode.InlineCompletionItem[] = definitionsKeys.map(key=>{
                    const isSnippet = key.includes('$')
                    return new vscode.InlineCompletionItem(
                        isSnippet? new vscode.SnippetString(key):key,new vscode.Range(position.line, 0, position.line, currentLine.text.length))
                });
                return lineCompletions;
            }
        });

        // vscode.languages.setLanguageConfiguration(editor.document.languageId,{
        //     onEnterRules: [
        //         {
        //             action: {
        //                 indentAction: vscode.IndentAction.None
        //             },
        //             beforeText: {}
        //         }
        //     ]
        // })
	}));

    context.subscriptions.push(vscode.commands.registerCommand('english-plus.changeSourceFile', async () => {
        vscode.commands.executeCommand('english-plus.openCodeFromTutorial',true);
	}));

}

export function deactivate() {}
