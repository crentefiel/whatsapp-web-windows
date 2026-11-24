# WhatsApp Desktop — Gráfica do Sorriso

Programa de Windows para atender o WhatsApp da gráfica. Conecta com Baileys (não abre o WhatsApp Web dentro do app), guarda o histórico neste computador e aprende com as respostas que você mesmo envia.

Versão atual: **0.4.3-beta.1**. O modo inicial é **Observação**: a IA não envia mensagem sozinha.

## Instalar

O instalador Windows (NSIS) sai pelo GitHub Actions neste repositório, na aba Actions, artefato `whatsapp-desktop-baileys-installer`. Instale por cima da versão anterior para manter conversas, sessão e memória. O arquivo não é assinado: o Windows pode avisar. O Controle de Aplicativo Inteligente, se estiver ligado, também bloqueia.

## O que a tela faz

- A janela não rola inteira. Rolam a lista, as mensagens e o miolo das configurações.
- A engrenagem abre em abas: **WhatsApp**, **Inteligência**, **Memória** e **Empresa**.
- No modo **Sugestão**, o texto da IA fica fixo acima do campo de digitar, para você editar e clicar em **Aprovar e enviar**.
- Dá para marcar conversas e apagar daqui. Isso tira a conversa e a memória desse cliente só neste computador. Não apaga no celular do cliente.

## Modos da IA

| Modo | O que acontece |
|---|---|
| Observação | Padrão. Grava o que o cliente falou e o que você respondeu. Não chama a API para responder e não envia. |
| Sugestão | Escreve um rascunho. Só sai depois de **Aprovar e enviar**. |
| Automático | Só depois de ativar a API e confirmar o aviso. Responde com exemplos parecidos. Preço que não está numa regra aprovada ou no cadastro da empresa fica bloqueado. |

A API é qualquer uma compatível com OpenAI (`/v1`, sem `/chat/completions` na URL). A chave fica no computador. Nada disso entra no GitHub.

Áudio sem texto entra na memória como `[áudio do cliente]`. O programa ainda não transcreve voz.

## Empresa

Na aba **Empresa** dá para gravar nome, horário, endereço e preços. **Buscar do WhatsApp** tenta puxar perfil e catálogo se o número for comercial. Preço escrito por você pode ser usado. Preço inventado pela IA não.

## Desenvolvimento

Windows 10/11 x64 e Node.js 22:

```cmd
npm install
npm test
npm start
```

Pareie em **Conectar WhatsApp**. A sessão, o SQLite e as mídias ficam na pasta `userData` do Electron, fora deste repositório.

## O que este repositório não é

Não é o WhatsApp oficial nem o Agente de Negócios da Meta. O Baileys é uma biblioteca não oficial. Não coloque aqui sessão, QR, chave de API, banco ou conversa de cliente.

A versão antiga, que abria o WhatsApp Web oficial, continua na ramificação `archive/whatsapp-web-oficial-0.2.0`.
