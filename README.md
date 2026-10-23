# NowPlaying

## 概要

![動作画像](docs/overlay.png)

再生中の音楽等をオーバーレイ表示します。  
Discord の RPC への表示も可能です。

## 使い方

### ダウンロード

[NowPlaying.exe](https://github.com/Alice-river/NowPlaying/releases/latest/download/NowPlaying.exe) をダウンロードして、実行してください。インストールは要りません。タスクトレイにアイコンが出ます。

初めて起動すると、「Windows によって PC が保護されました」と表示されることがあります。署名をしていない exe のためです。「詳細情報」を押して、「実行」を選んでください。

曲の情報は、Chrome の拡張機能 [WebNowPlaying](https://github.com/keifufu/WebNowPlaying) から受け取ります。先に拡張機能を入れておいてください。

### 設定

**WebNowPlaying 側の設定**

1. WebNowPlaying の設定を開く
2. 接続先の追加（Add custom adapter など）で、ポートに `37250` を指定する
3. Chrome で曲を再生する

画面の右上にオーバーレイが出れば、つながっています。

**NowPlaying 側の設定**

トレイのアイコンをダブルクリックすると、設定画面が開きます。

| 項目 | 内容 |
| --- | --- |
| 透過率 | オーバーレイの背景の濃さ |
| 後ろをぼかす | 背景をすりガラスにします。切ると、後ろの画面がそのまま透けます |
| Discord | Discord への表示の切り替えと、Application ID の入力 |
| Windows の起動時に自動で起動する | オンにすると、サインインのたびに自動で起動します |

オーバーレイは、ドラッグで好きな位置に動かせます。一時停止から10秒たつと、自動で隠れます。トレイを右クリックすると、一時的に隠す、クリックを通す、位置を右上に戻す、の操作ができます。

### Discord連携

Discord への表示には、自分用のアプリケーションが1つ必要です。3分ほどで作れます。

1. [Discord Developer Portal](https://discord.com/developers/applications) を開いて、「New Application」を押す
2. 名前を付けて作成する（この名前が、プロフィールの表示名の予備になります）
3. 「General Information」にある **Application ID** をコピーする
4. NowPlaying の設定画面を開いて、「Discord」の欄の Application ID に貼り付ける

欄の下の「状態」が「接続中」になれば完了です。プロフィールに「（曲名）を再生中」と、アーティスト、カバー、進行バーが出ます。

入力するのは Application ID だけです。トークンやシークレットは必要ありません。入力しないでください。

Discord のデスクトップアプリが起動している必要があります（ブラウザ版では使えません）。NowPlaying を先に起動していても、Discord が起動すれば自動でつながります。
