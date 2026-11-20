# WhatsApp Web para Windows — Gráfica do Sorriso

## Primeira etapa: WhatsApp funcionando antes da IA

Aplicativo desktop Windows em **Electron** que abre o **WhatsApp Web oficial** em uma janela independente. É um projeto separado do WhatsApp IA anterior.

Nesta fase, **não usa Baileys, não cria banco de mensagens e não integra inteligência artificial**. Em vez de tentar reconstruir a criptografia e a sincronização de conversas, usa diretamente os recursos disponibilizados pelo próprio WhatsApp Web.

### Recursos desta primeira versão

- Pareamento pelo QR Code do WhatsApp Web.
- Conversas e mensagens de texto, recebidas e enviadas através do site oficial.
- Imagens, áudios, vídeos e documentos conforme os recursos disponíveis no WhatsApp Web.
- Solicitação de permissão de microfone e recursos de mídia.
- Downloads com escolha do local de salvamento.
- Sessão persistente entre aberturas, armazenada localmente pelo Electron.
- Janela própria, menu em português, recarregamento e zoom.
- Conteúdo web em sandbox, sem Node.js; links externos no navegador padrão.

### Limitações e transparência

- **Não é um cliente WhatsApp independente nem uma API.** Renderiza o WhatsApp Web oficial dentro do Electron.
- A compatibilidade do WhatsApp Web com navegador embutido **precisa ser comprovada em teste real** e pode mudar; o serviço pode restringir esse tipo de acesso.
- O programa **não intercepta mensagens nem as grava em SQLite**. Para aprendizado por observação e automações futuras será necessária uma nova integração planejada e autorizada.
- Testes automatizados locais verificam regras de segurança, **não comprovam envio/recebimento real** ou gravação de áudio.
- Projeto independente, não afiliado à Meta ou WhatsApp LLC.

### Requisitos para desenvolvimento

- Windows 10/11 x64.
- Node.js e npm para compilar/gerar o instalador.
- Acesso à internet para usar WhatsApp Web.

### Executar

Abra o CMD na pasta do projeto:

```cmd
npm install
npm test
npm start
```

Para parear, use no celular: **WhatsApp > Dispositivos conectados > Conectar um dispositivo** e escaneie o QR Code.

### Gerar instalador para Windows

```cmd
npm run package:windows
```

O instalador será gerado em `release/`; seu executável será independente do Node.js instalado no computador do usuário final. **O instalador ainda não foi gerado ou testado em um PC Windows nesta entrega.** Ele não possui assinatura digital.

### Teste de aceite real obrigatório

1. Abrir o aplicativo e conectar pelo QR Code.
2. Enviar “oi” de uma segunda conta autorizada e confirmar que aparece na conversa certa.
3. Enviar uma resposta e confirmar no outro aparelho.
4. Repetir o teste com imagens, documentos, áudio recebido e áudio gravado.
5. Reiniciar o programa e verificar que a sessão e o histórico continuam acessíveis.
6. Testar download e abertura de anexos.

Não declarar esses itens aprovados sem execução real.

### Segurança e privacidade

- **Nunca publique a pasta de sessão do Electron, cookies, tokens, credenciais ou conversas de clientes.**
- Não reutilize a sessão `baileys_auth` do sistema antigo.
- O repositório GitHub contém exclusivamente código, testes e documentação.
- Links externos são abertos no navegador padrão.

### Estrutura

- `src/main.cjs`: janela Electron, sessão, permissões, downloads e menus.
- `src/security.cjs`: validação de URLs, saneamento de nomes e user-agent.
- `test/security.test.cjs`: testes locais.
- `.github/workflows/test.yml`: checagem automatizada de sintaxe e testes no GitHub.

### Próximo passo

Testar a versão Windows com conta real. Só após validar o uso básico planejar a futura integração de IA e aprendizado por observação, sem misturar protótipos com dados de produção.
