import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
const fetch = require('node-fetch');

let registerMode = false;

const DEFAULT_PROMPT = `
あなたは日本語と曖昧な英語混じりの文章を正確なCSSコードに変換するAIです。

- クラス名やセレクター名は意味を補完し、必要なら仮名を補って書き直す
-「クラス◯◯」と始まる文では .◯◯ { を出力
-「なみ(」はセレクター開始 { 「なみとじる」はセレクター終了 } を出力
-「なみ」や「クラス」という言葉がなければ基本的に新しいセレクターに移行しない。同一セレクタに対するプロパティを出力する
- 「アスペクト比16対9」→ aspect-ratio: 16 / 9;
- 擬似要素、擬似クラスも音声入力ベースで補完して構文に整形する（例: 「ノットファーストチャイルド」→ :not(:first-child)）
- 可能であれば mask や background のようなプロパティはショートハンドにまとめる
- CSS変数（「バリアブル」や「変数」）というワードが入れば var(--xxxxx) として変換
- コード以外の出力は禁止。整形済みCSSのみを返すこと。
- 出力結果を \`\`\`css などで囲まない
`;

export function activate(context: vscode.ExtensionContext) {
  const dictionaryPath = path.join(context.globalStorageUri.fsPath, 'user-dictionary.json');
  vscode.workspace.fs.createDirectory(context.globalStorageUri);

  // 登録モード切り替えコマンド登録
  context.subscriptions.push(
    vscode.commands.registerCommand('css-talk.toggleRegisterMode', () => {
      registerMode = !registerMode;
      vscode.window.showInformationMessage(`登録モード: ${registerMode ? 'ON' : 'OFF'}`);
    })
  );

  // 現在行を辞書に登録するコマンド登録
  context.subscriptions.push(
    vscode.commands.registerCommand('css-talk.registerLine', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const currentLine = editor.document.lineAt(editor.selection.active.line).text;
      const matchVars = currentLine.match(/--[\w-]+\s*:\s*[^;]+/g);
      const matchClasses = currentLine.match(/\.[\w-]+/g);

      let data: { variables: Record<string, string>, classes: string[] } = {
        variables: {},
        classes: []
      };

      try {
        if (fs.existsSync(dictionaryPath)) {
          const file = fs.readFileSync(dictionaryPath, 'utf-8');
          data = JSON.parse(file);
        }
      } catch (err) {
        console.error('辞書ファイルの読み込みに失敗', err);
      }

      if (matchVars) {
        for (const v of matchVars) {
          const [key, value] = v.split(':').map(s => s.trim());
          if (key && value) {
            data.variables[key] = value;
            vscode.window.showInformationMessage(`変数 ${key} を登録しました`);
          }
        }
      }

      if (matchClasses) {
        for (const className of matchClasses) {
          if (!data.classes.includes(className)) {
            data.classes.push(className);
            vscode.window.showInformationMessage(`クラス ${className} を登録しました`);
          }
        }
      }

      fs.writeFileSync(dictionaryPath, JSON.stringify(data, null, 2));
    })
  );

  // 音声入力テキストをCSSに変換するコマンド登録
  context.subscriptions.push(
    vscode.commands.registerCommand('css-talk.transformToCSS', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const line = editor.document.lineAt(editor.selection.active.line);
      const text = line.text;

      const apiKey = vscode.workspace.getConfiguration().get<string>('css-talk.apiKey');
      const systemPrompt = vscode.workspace.getConfiguration().get<string>('css-talk.systemPrompt') || DEFAULT_PROMPT;

      if (!apiKey) {
        vscode.window.showErrorMessage('APIキーが設定されていません。settings.json で css-talk.apiKey を指定してください。');
        return;
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ],
          temperature: 0.7,
          max_tokens: 800
        })
      });

      const data: any = await response.json();

      if (!data || !data.choices || !data.choices[0]?.message?.content) {
        vscode.window.showErrorMessage('CSS変換に失敗しました（OpenAI APIエラー）');
        return;
      }

      editor.edit(editBuilder => {
        const range = line.range;
        editBuilder.replace(range, data.choices[0].message.content.trim());
      });
    })
  );
}

export function deactivate() {}
