# WhatsApp Desktop — Gráfica do Sorriso

Programa de Windows para atender o WhatsApp da gráfica. Conecta com Baileys (não abre o WhatsApp Web dentro do app), guarda o histórico neste computador e aprende com as respostas que você mesmo envia.

Versão atual: **0.4.6-beta.1**. O modo inicial é **Observação**: a IA não envia mensagem sozinha.

## Instalar

O instalador Windows (NSIS) sai pelo GitHub Actions neste repositório, na aba Actions, artefato `whatsapp-desktop-baileys-installer`. Instale por cima da versão anterior para manter conversas, sessão e memória. O arquivo não é assinado: o Windows pode avisar. O Controle de Aplicativo Inteligente, se estiver ligado, também bloqueia.

## O que a tela faz

- A janela não rola inteira. Rolam a lista, as mensagens e o miolo das configurações.
- A engrenagem abre em abas: **WhatsApp**, **Inteligência**, **Memória** e **Empresa**.
- No modo **Sugestão**, o texto da IA fica fixo acima do campo de digitar, para você editar e clicar em **Aprovar e enviar**.
- Dá para marcar conversas — o botão **Todos** pega a lista inteira, não só as que aparecem na tela — e apagar daqui. Isso tira a conversa e a memória desse cliente só neste computador. Não apaga no celular do cliente.
- Na aba **Memória** dá para apagar exemplos marcados ou todos os exemplos do contato aberto. A IA deixa de usar o que foi apagado. A sua resposta entra na memória mesmo horas ou alguns dias depois (até 7 dias). Ao abrir o programa, ele relê o histórico que já está neste computador. Se o WhatsApp trocar o identificador do contato, os exemplos acompanham o número.
- Na conversa, **Estou atendendo** faz a IA parar naquele contato até **Devolver para a IA**. Se o cliente pedir uma pessoa ou para apagar os dados, a IA para sozinha e avisa na tela. Nada é apagado sozinho.

## Modos da IA

| Modo | O que acontece |
|---|---|
| Observação | Padrão. Grava o que o cliente falou e o que você respondeu. Não chama a API para responder e não envia. |
| Sugestão | Escreve um rascunho. Só sai depois de **Aprovar e enviar**. |
| Automático | Depois de confirmar o aviso. Se o modelo e a chave já estiverem salvos, essa confirmação liga o envio. Responde com exemplos parecidos. Preço que não está numa regra aprovada ou no cadastro da empresa não é inventado: a IA avisa que você vai confirmar e para nessa conversa. |

A API é qualquer uma compatível com OpenAI (`/v1`, sem `/chat/completions` na URL). A chave fica no computador. Nada disso entra no GitHub.

Áudio sem texto entra na memória como `[áudio do cliente]`. Documento entra como documento. O programa ainda não lê áudio nem arquivo. Isso fica para uma versão seguinte.

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
