# WhatsApp Desktop para Windows — Gráfica do Sorriso

## Fase Baileys + IA opcional — versão 0.2.0 (em desenvolvimento)

Aplicativo desktop independente em Electron, com **conexão WhatsApp pelo Baileys**, sem carregar o WhatsApp Web dentro de um navegador embutido. **Possui IA opcional configurável via API compatível com OpenAI, desativada por padrão**. A implementação anterior permanece no histórico Git.

### Recursos implementados no código

- QR Code de pareamento Baileys na janela Windows após clicar **Conectar WhatsApp**.
- Credenciais em pasta local do aplicativo; sem reutilizar sessão do projeto antigo.
- Retomada automática ao reabrir o aplicativo quando já há uma sessão Baileys salva; primeiro pareamento continua manual.
- Reconexão após quedas, sem logout automático nem exclusão da sessão.
- Campo de mensagem disponível para escrever rascunho com contato selecionado mesmo offline; envio de texto e arquivos somente quando conectado.
- Eventos de recebimento e sincronização oferecidos pela biblioteca.
- SQLite WAL, histórico persistente e prevenção de mensagens duplicadas.
- Conversas e nomes, com preservação dos identificadores `@lid` e `@s.whatsapp.net` sem deduzir associação indevida.
- Recebimento e visualização de texto, imagem, áudio, vídeo e documento, quando os dados estão disponíveis.
- Envio **manual** de texto, fotos, vídeos e áudio em arquivo. A opção **Documento / qualquer arquivo** aceita PDF, Word (DOC/DOCX), Excel (XLS/XLSX), PowerPoint (PPT/PPTX), ZIP, CDR e outras extensões, dentro do limite atual do aplicativo de 100 MB por arquivo (sujeito a limites do WhatsApp).
- Documentos, áudios, imagens e vídeos recebidos são armazenados binariamente no disco, em pastas separadas por contato e categoria. No cabeçalho da conversa, **Arquivos do contato** abre essa pasta no Windows.
- Consulta sob demanda de foto de perfil quando disponível.
- Indicadores da última mensagem processada, última gravação e erros.
- Respostas automáticas opcionais com provedores compatíveis com OpenAI (`POST /chat/completions`), somente em conversas individuais autorizadas manualmente.
- Chave de API criptografada pelo cofre seguro do Electron/Windows quando disponível; nunca exposta no painel nem incluída nos diagnósticos.
- IA ativada apenas após salvar modelo, endpoint, chave (para API remota), autorização de contatos e marcar a opção de ativação; ignora mensagens de grupos, canais, comunidades, status, mensagens próprias e histórico sincronizado.

### Limitações e recursos pendentes

- **Ainda falta confirmar o QR, os envios, os recebimentos e a reprodução das mídias em um teste real do Windows**. Testes automatizados não provam isso.
- O envio de áudio existente seleciona um arquivo: **gravação por microfone e mensagens de voz PTT ficam para outra etapa**.
- Ainda faltam edição/exclusão de mensagens, respostas com citação, reações, recibos de leitura e diversos recursos avançados.
- O WhatsApp nem sempre disponibiliza todos os contatos, fotos, históricos e mídias antigas a clientes vinculados.
- IDs `@lid` não devem ser convertidos em números sem uma correspondência realmente recebida.
- O Baileys não é oficial, pode ter recursos indisponíveis, mudanças de protocolo e restrições de conta.
- Anexos locais não são criptografados nesta fase; validar requisitos de privacidade antes de usar dados sensíveis de clientes.

### Instalar e executar para desenvolvimento

Windows 10/11 x64, Node.js 22 ou superior:

```cmd
npm install
npm run check
npm test
npm start
```

Clique em **Conectar WhatsApp**. No telefone, entre em **Dispositivos conectados → Conectar dispositivo**. A sessão é salva no diretório local `userData` do Electron, fora do repositório GitHub.

### Gerar instalador Windows

```cmd
npm run package:windows
```

O GitHub Actions compila o instalador como artefato nas execuções correspondentes. A compilação não confirma que mensagens reais foram recebidas.

### Testes obrigatórios antes de homologar

1. Parear uma conta autorizada pelo QR Code.
2. Enviar um “oi” do WhatsApp pessoal para a conta vinculada e acompanhar o recebimento, a persistência SQLite e a exibição na interface.
3. Responder pelo aplicativo, confirmar no telefone de destino e reiniciar para testar a persistência.
4. Repetir os testes com imagens, PDF, áudio e vídeo recebidos e enviados.
5. Testar os nomes, as fotos dos contatos, grupos, ID `@lid`, reconexão e falha de rede.
6. Auditar logs e confirmar que nenhuma mídia, sessão ou conversa foi publicada no GitHub.

**Ativar IA somente após validar o atendimento real com um contato de teste.** As respostas automáticas ficam desligadas na primeira instalação. O sistema não deve disparar IA em histórico antigo.

### Privacidade e segurança

O repositório é **público** e contém apenas código. Nunca adicionar QR Code, sessão, chaves, banco SQLite, logs privados ou mensagens de clientes. Não vincular duas instâncias Baileys simultaneamente com as mesmas credenciais. Projeto independente e não afiliado à Meta ou WhatsApp.

### Correção de contatos e arquivos locais

A lista mostra somente conversas individuais (`@s.whatsapp.net` e `@lid`); grupos, canais, comunidades e status são ignorados. O aplicativo preserva os IDs internos em vez de inventar números.

Os arquivos recebidos ficam no disco local em `userData/media/contatos/<numero>/documentos`, `fotos`, `audios`, `videos` ou `figurinhas`. Para contatos identificados apenas por ID interno usa-se `LID-<id>`. Anexos das versões anteriores em `userData/media/<uuid>` continuam acessíveis. Se o download falhar, o histórico da mensagem é mantido, e a recuperação será tentada se o evento reaparecer. Nenhuma sessão ou conversa deve ser publicada no GitHub.

A validação com WhatsApp real no Windows ainda é necessária para cada versão, inclusive IA e reconexão.

### Configurar IA OpenAI-compatible (somente texto nesta fase)

1. Abra a engrenagem **Configurações → Inteligência artificial**.
2. Informe a **URL base**, por exemplo `https://api.openai.com/v1` ou `http://localhost:11434/v1` para API local compatível. Não coloque `/chat/completions` no endereço.
3. Informe o nome do modelo exatamente como cadastrado no provedor e, para API remota, a chave de API. A chave é armazenada em `userData/ia-chave.enc`, criptografada via `safeStorage` quando o recurso está disponível. Sem criptografia do sistema, o aplicativo não aceita salvar a chave.
4. Personalize as instruções da IA na engrenagem. **Não compartilhe aqui ou no GitHub a chave de API ou conversas de clientes**.
5. Abra uma conversa individual e clique **Autorizar IA**. A autorização é individual. Sem autorização, não há resposta automática.
6. Volte às configurações, marque **Ativar respostas automáticas** e clique **Salvar configurações da IA**. Use primeiro um contato de teste. Para parar imediatamente, desmarque e salve.
7. Para excluir o segredo armazenado, clique **Apagar chave salva**. A IA será desligada.

O botão **IA autorizada** em cada conversa permite retirar a autorização. A IA responde apenas textos novos recebidos pelo Baileys no evento `notify`; **nunca deve responder importação de histórico**. Por padrão as respostas têm prefixo `🤖` para identificar o assistente. As mensagens de contexto (até 12 recentes, em texto) são enviadas ao serviço escolhido. Serviços externos podem cobrar pelo uso e processar esses dados em seus servidores. O sistema faz no máximo 20 respostas por hora por contato, espera pelo menos 8 segundos entre respostas e reúne mensagens recebidas próximas.

O suporte à IA é **experimental** e requer validação real do Windows/WhatsApp; os testes de API e de mensagens são simulados. Nesta fase, a IA não interpreta áudio, imagens nem documentos para responder: o envio e recebimento desses arquivos continua sob controle manual. O Baileys é uma biblioteca não oficial e não há garantia de disponibilidade ininterrupta.
