import * as vscode from 'vscode';

async function pickFile(label:string): Promise<vscode.TextDocument>{
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
        throw new Error('Parameter is not a number!');
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
        let tutorialCodeDocument: vscode.TextDocument;
        if(!contextUriPath || ignoreContextUriPath){
            tutorialCodeDocument = await pickFile("Select file with code from tutorial...");
            if(!tutorialCodeDocument){
                return
            }
            context.globalState.update(editor.document.fileName,tutorialCodeDocument.uri.path)
        }else{
            tutorialCodeDocument = await vscode.workspace.openTextDocument(contextUriPath);
        }
        console.log(tutorialCodeDocument.fileName)
        //const currentTextFile = editor.document
        //console.log(currentTextFile.lineAt(0))
        
        //editor.edit(editBuilder => {
        //    editBuilder.insert(new vscode.Position(0,0),"#EnglishPlus: "+tutorialCodeDocument?.);
        //});
	}));

    context.subscriptions.push(vscode.commands.registerCommand('english-plus.changeSourceFile', async () => {
        vscode.commands.executeCommand('english-plus.openCodeFromTutorial',true)
	}));
}

export function deactivate() {}
