# WhatsApp Web para Windows — Gráfica do Sorriso

Aplicativo desktop Windows em **Electron** que abre o **WhatsApp Web oficial** e inclui um **Modo Observador de IA**.

## Modo Observador (padrão)

Enquanto você responde as mensagens normalmente no WhatsApp Web da empresa, a IA observa:

- A mensagem que chegou
- A resposta que **você** enviou

Ela salva esses pares localmente para aprender o seu estilo de resposta.

### Modos disponíveis (menu “Modo IA”)

- **Observador (aprender)** — padrão. Só observa e salva exemplos.
- **IA responde sozinha** — (em desenvolvimento) gera e envia automaticamente.
- **IA responde com aprovação** — (em desenvolvimento) mostra a sugestão para você aprovar antes de enviar.

### Visualizar o aprendizado

Menu **Modo IA → Ver aprendizado da IA**

Abre uma janela local mostrando todos os exemplos salvos (mensagem recebida → sua resposta), com data e chat.

Os dados ficam em um arquivo JSON na pasta de dados do aplicativo (`userData/ia-aprendizado.json`). Nada é enviado para fora.

## Recursos gerais

- Pareamento pelo QR Code do WhatsApp Web.
- Sessão persistente.
- Suporte a mídia conforme o WhatsApp Web.
- Menu em português, zoom, recarregar.
- Downloads com escolha de pasta.

## Importante

- Continua usando o **WhatsApp Web oficial** (não é Baileys nem API não oficial).
- A observação é feita por injeção de script no DOM. Os seletores podem precisar de ajuste se o WhatsApp mudar o layout.
- Projeto independente, não afiliado à Meta ou WhatsApp.
- **Nunca publique** a pasta de sessão ou o arquivo de aprendizado se contiver dados de clientes.

## Executar

```cmd
npm install
npm start
```

## Estrutura

- `src/main.cjs` — janela principal, menus, modos e ponte de aprendizado
- `src/learning-db.cjs` — banco local de exemplos (JSON)
- `src/observer-inject.js` — script injetado no WhatsApp Web
- `src/learning-viewer.html` + `learning-preload.cjs` — visualizador do aprendizado
- `src/security.cjs` — validações de segurança

## Próximos passos

- Ajustar seletores do observador conforme testes reais
- Integrar geração de respostas com API de IA (configurável)
- Modos de resposta automática e com aprovação
