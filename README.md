# WhatsApp Desktop para Windows — Gráfica do Sorriso

## Fase Baileys + IA opcional — versão 0.4.0-beta.1 (em desenvolvimento)

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
5. No painel, escolha **Quem a IA pode responder?**: **Todos os contatos individuais** (responde a qualquer conversa individual nova, excluindo grupos/canais/comunidades/status) ou **Somente contatos autorizados**. No segundo modo, abra uma conversa individual e clique **Autorizar IA**. O modo padrão continua sendo contatos selecionados e IA desligada.
   Atenção: no modo todos, o provedor da API poderá receber o histórico textual recente de qualquer contato individual que escrever para você; escolha conscientemente e informe os usuários quando necessário.
6. Marque **Ativar respostas automáticas** e clique **Salvar configurações da IA**. Se aparecer erro, o formulário mantém os valores para correção. Use primeiro um contato de teste. Para parar, desmarque e salve.
7. Para excluir o segredo armazenado, clique **Apagar chave salva**. A IA será desligada.

**Se a IA não responder:** primeiro salve a URL, o modelo e a chave. Clique em **Testar conexão com a IA**, dentro da engrenagem; esse teste envia apenas uma frase sintética à API, **não** envia nada no WhatsApp nem usa conversas reais. O resultado informa se o provedor respondeu ou se houve erro de autenticação (401/403), URL/modelo (404), limites (429), rede ou incompatibilidade. Depois, confirme que a opção de respostas está **ativa** e que o contato da conversa aparece como **IA autorizada**. Envie uma mensagem NOVA a partir do outro telefone para fazer o teste (não vale apenas reler o histórico). Os contadores "Entradas avaliadas", "Chamadas à API" e "Respostas enviadas" ajudam a localizar a falha. Em **WhatsApp → Copiar diagnóstico**, o objeto `ai` pode ser compartilhado sem chave, conteúdo de conversas ou dados de contatos.

O acionamento respeita apenas eventos `notify` do Baileys; se o WhatsApp entregar um `append` e depois um `notify` com o mesmo ID, a IA responde uma vez ao `notify` recente, mesmo que a mensagem já tenha sido armazenada, mas não responde a eventos de histórico. A IA não responde mensagens anteriores a cinco minutos nem mensagens próprias.

No modo **Somente contatos autorizados**, o botão **IA autorizada** em cada conversa permite retirar a autorização. No modo **Todos os contatos individuais**, não é preciso autorizar cada número. A IA responde apenas textos novos recebidos pelo Baileys no evento `notify`; **nunca deve responder importação de histórico**. Por padrão as respostas têm prefixo `🤖` para identificar o assistente. As mensagens de contexto (até 12 recentes, em texto) são enviadas ao serviço escolhido. Serviços externos podem cobrar pelo uso e processar esses dados em seus servidores. O sistema faz no máximo 20 respostas por hora por contato, espera pelo menos 8 segundos entre respostas e reúne mensagens recebidas próximas.

O suporte à IA é **experimental** e requer validação real do Windows/WhatsApp; os testes de API e de mensagens são simulados. Nesta fase, a IA não interpreta áudio, imagens nem documentos para responder: o envio e recebimento desses arquivos continua sob controle manual. O Baileys é uma biblioteca não oficial e não há garantia de disponibilidade ininterrupta.

### Correção 0.3.3 — mensagens recebidas, mas sem resposta automática

O diagnóstico podia exibir **"Último bloqueio: Mensagem antiga; sem resposta automática"** mesmo quando o aplicativo recebia mensagens novas: uma regra de cinco minutos comparava o horário da mensagem do WhatsApp com o relógio do Windows e rejeitava inclusive mensagens datadas no futuro. O vídeo do teste real mostrou divergência entre horários e esse bloqueio.

Agora o aplicativo confia no evento `notify` para identificar uma mensagem nova, não descarta mensagens por diferença de minutos entre os relógios e rejeita somente eventos com mais de **24 horas no passado**. O histórico sincronizado via `append` ou `messaging-history.set` continua sem acionar respostas, e os IDs de mensagens continuam protegidos contra duplicidade.

**Teste real:** instale a versão 0.3.3 preservando a pasta `userData`; confira se o WhatsApp está conectado e a IA está realmente ativada. Peça a outro contato para enviar uma mensagem NOVA e confira em Configurações → Inteligência artificial se `Entradas avaliadas`, `Agendadas`, `Chamadas à API` e `Respostas enviadas` aumentam. Testar a API isoladamente com `OK` não comprova o envio automático pelo WhatsApp. Se o relógio do Windows estiver incorreto, sincronize a data e hora do sistema também.

## Fase 0.4.0-beta.1 — observação, sugestões e memória persistente (experimental)

**Base funcional preservada:** a versão 0.3.3 que já passou por testes reais de QR Code, mensagens, arquivos e IA foi mantida na ramificação `stable/whatsapp-baileys-ai-0.3.3-working` (commit `28d496729417177c47a77cbcef28f292c0c4a8e2`). Esta nova fase foi feita na ramificação independente `feat/observation-learning-memory`, sem modificar a referência estável. Por enquanto não unir a nova ramificação ao aplicativo de produção.

### Os três modos — ⚙ → Memória e aprendizado

- **Observação (padrão da nova fase):** nunca envia mensagens em nome da IA nem faz consultas à API para aprender. O Baileys captura as mensagens individuais enviadas e recebidas, incluindo respostas humanas que chegam como mensagens `fromMe` do WhatsApp Web/celular ou digitadas neste aplicativo. O histórico está em SQLite, com exemplos de pergunta do cliente e resposta humana vinculados ao contato.
- **Sugestão:** diante de uma nova mensagem individual, consulta a API compatível com OpenAI com contexto desse cliente, regras aprovadas e exemplos relevantes. Mostra rascunho editável. Só envia após **Aprovar e enviar**; também permite rejeitar. O envio aprovado vira um exemplo humano para aquele cliente.
- **Automático:** exige ativação explícita e confirmação. Só considera conversas individuais permitidas e novas notificações `notify`, com histórico/contexto. Requer um exemplo humano suficientemente semelhante para responder. Respostas citando preços não aprovados são bloqueadas; se não houver informação segura, deixa a conversa para uma pessoa. Ao identificar que o proprietário respondeu, interrompe sugestões pendentes e pausa aquele atendimento por dez minutos.

Grupos, comunidades, canais, status e mensagens antigas sincronizadas não disparam respostas. O sistema **não treina pesos do modelo**, mas utiliza memória, exemplos e regras persistidos no computador. Os arquivos e credenciais do WhatsApp não são migrados nem apagados por essa mudança.

### Memória de atendimentos

O banco `conversas.sqlite` recebe tabelas adicionais para modo de operação, exemplos pergunta→resposta, sugestões, regras rascunho/aprovadas/rejeitadas, mensagens da IA e pausas humanas. O histórico de mensagens já recebido pelo Baileys continua na tabela original `messages`: a visualização pode limitar quantas mensagens carrega, mas a importação de exemplos percorre o histórico local existente, e não apenas as últimas 200 linhas da interface.

Clique em **Importar exemplos do histórico local** para relacionar respostas humanas de conversas armazenadas. O programa não envia o histórico à API nesse processo; somente transforma pares já guardados em exemplos editáveis e revisáveis. Cada exemplo mantém o contato e a origem. Na conversa selecionada, aprove/corrija ou rejeite exemplos. Cadastre regras novas como **rascunho** e aprove-as individualmente antes de tratá-las como políticas oficiais. Preços observados nunca se tornam oficiais automaticamente.

As solicitações ao provedor de IA em Sugestão/Automático podem incluir até 12 mensagens textuais recentes do cliente selecionado, exemplos relevantes desse mesmo cliente e regras aprovadas; dados brutos de outros clientes não são misturados. Uma agregação local de estilo geral pode orientar o tamanho e a frequência de saudações, sem enviar textos de outras conversas. Clientes não ficam automaticamente informados sobre processamento externo; forneça os avisos de privacidade aplicáveis.

**Atenção:** anexos e banco SQLite continuam locais e sem criptografia de disco adicional nesta versão; use controles e backup adequados. A sincronização de histórico antigo depende do que o WhatsApp disponibiliza ao dispositivo vinculado. Não há garantia de recuperar mensagens que o Baileys nunca entregou.

### Validação antes de usar em produção

1. Fazer cópia da pasta `userData`, incluindo `baileys_auth`, `conversas.sqlite`, `media` e `ia-config.json`. Instalar a beta preservando esses dados. Confirmar QR Code, reconexão, texto e anexos.
2. Confirmar **Observação** como modo inicial. Enviar mensagens de um telefone autorizado e responder manualmente pelo WhatsApp Web. Verificar que não houve resposta automática e que o exemplo apareceu na memória do contato correto.
3. Importar o histórico local, revisar os exemplos e aprovar uma regra de teste. Verificar que nenhuma regra de preço se tornou aprovada sem ação explícita.
4. Entrar no modo **Sugestão**, enviar uma mensagem nova e confirmar que o texto sugerido aparece, mas não sai do WhatsApp enquanto não clicar **Aprovar e enviar**. Editar, aprovar e conferir entrega no destino.
5. Confirmar que uma resposta humana no Web/celular interrompe a automação e que grupos/canais/status continuam excluídos.
6. Apenas com clientes de teste e exemplos aprovados, selecionar **Automático** e confirmar o diálogo. Avaliar limites, informações comerciais, histórico e diagnóstico sem expor conversas de clientes.
7. Se algo falhar, voltar ao modo **Observação** ou à versão estável 0.3.3, conservando a cópia de segurança. Nenhum teste automatizado substitui o teste real no seu Windows.

**Não habilitar Automático em contatos de clientes reais antes de homologar a beta.**
