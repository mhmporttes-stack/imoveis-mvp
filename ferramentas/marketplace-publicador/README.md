# Publicador do Facebook Marketplace (extensão do Chrome)

Extensão pessoal do Matheus Machado Corretor de Imóveis. Pega no CRM **só os anúncios que você aprovou** (Cadastros › Marketplace) e publica sozinha no Facebook Marketplace, pelo seu perfil, usando a sessão do Facebook que já está aberta no seu Chrome.

## Aviso de risco (leia antes)

- Publicar por automação **não é permitido pelos termos do Facebook**. O Facebook pode pedir verificação, limitar publicações ou bloquear a conta. Você decidiu aceitar esse risco (volume baixo).
- Para reduzir o risco a extensão: publica no máximo **3 anúncios por dia**, só das **08:00 às 20:00** (horário de Brasília), com 2 a 5 minutos entre um e outro, digita em ritmo humano e **pausa 24 h** se o Facebook mostrar verificação, bloqueio ou aviso de limite.
- Nada é publicado sem o seu "sim": o anúncio só entra na fila quando você toca em **"Aprovado — publicar no Marketplace"** no CRM. Se editar o anúncio depois, a aprovação cai e precisa aprovar de novo.

## Instalar (Carregar sem compactação)

1. Descompacte `marketplace-publicador.zip` numa pasta que você não vai apagar (ex.: `Documentos\marketplace-publicador`).
2. No Chrome, abra `chrome://extensions`.
3. Ligue **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta.
5. Fixe o ícone da extensão na barra (ícone de quebra-cabeça › alfinete).

## Atualizar para uma versão nova

1. Descompacte o zip novo **por cima da mesma pasta** (substituindo os arquivos).
2. Em `chrome://extensions`, clique no botão de recarregar (seta circular) do "Publicador Marketplace".
3. A chave e as opções continuam salvas — não precisa configurar de novo.

## Configurar

1. No CRM: **Cadastros › Marketplace › Gerar chave**. Copie a chave (`mkp_...`) — ela aparece uma vez só.
2. Na extensão: botão direito no ícone › **Opções**. Endereço do CRM já vem preenchido (`https://www.matheusmachadoimoveis.com.br`). Cole a chave e **Salvar**.
3. Opcional: marque "Guardar print da tela quando uma publicação falhar" (o print fica só no seu computador, no histórico do popup).

Gerar uma chave nova no CRM desliga a anterior — cole a nova nas Opções.

## Como funciona

- A cada ~15 minutos (com o Chrome aberto e o computador ligado) a extensão pergunta ao CRM se há anúncio aprovado.
- Se houver: abre o "Novo classificado de imóvel" (`facebook.com/marketplace/create/rental`; se não abrir direto, vai em "Escolha o tipo de classificado" e clica em "Imóvel residencial para venda ou locação"), baixa as fotos do CRM e envia, escolhe venda ou locação, tipo de imóvel, quartos, banheiros, preço, localização ("bairro, Marília" — 1ª sugestão; sem sugestão, só "Marília"), descrição e, se houver, metros quadrados, IPTU, condomínio e vagas. Deixa **"Turbinar classificado" desligado**, nunca clica em "Salvar rascunho" nem marca grupos, clica em Avançar e Publicar, pega o link do classificado e avisa o CRM (o status e o link aparecem na tela do CRM).
- O formulário de imóvel do Facebook não tem campo "Título" (o Facebook monta o título pelos dados); o título fica só no CRM, para você se organizar.
- Deu certo: a aba fecha e chega uma notificação. Deu errado: a aba fica aberta para você ver, chega uma notificação com o passo que falhou e o CRM marca "Falhou" com a descrição.
- Abre sempre uma **aba nova só para isso** (nunca mexe na aba em que você está) e fecha no final. Se o formulário não abrir direto, passa pela escolha do tipo de classificado e, por último, pelo "+ Criar novo classificado" do menu; o erro mostra as páginas atingidas.
- Limites: só publicação **bem-sucedida** conta nas 3 do dia (entre uma publicação e a próxima, 2–5 min). Depois de uma falha, tenta de novo em 15–20 min (no máximo **2 tentativas por anúncio** e 6 tentativas no dia). Se a falha foi **depois** de clicar em Publicar, não tenta de novo (evita anúncio duplicado) — confira no Facebook e, se não saiu, toque em **"Tentar de novo"** no CRM.

## Faixa "está depurando este navegador" (normal)

Durante cada publicação o Chrome mostra no alto da aba a faixa **"Publicador Marketplace começou a depurar este navegador"**. É normal: a extensão usa esse modo para clicar e digitar como uma pessoa (o campo de localização do Facebook ignora cliques automáticos comuns). A faixa some quando a publicação termina e a aba fecha. **Não clique em "Cancelar"** na faixa durante a publicação (a extensão volta para o modo comum e a localização pode falhar).

## Popup

Mostra a situação (ativo, pausado, publicando), quantas publicações hoje, quando pode publicar de novo, a última verificação e o histórico. **Pausar** para tudo até você tocar em **Retomar** (Retomar também encerra a pausa de 24 h depois de você resolver a verificação no Facebook). **Verificar agora** respeita as mesmas regras de horário e limite.

## Quando o Facebook muda a tela

Os textos e rótulos que a extensão procura ficam todos em `selectors.js` (pt-BR e inglês). Se um passo começar a falhar sempre no mesmo lugar ("Campo X não encontrado"), ajuste a lista daquele campo nesse arquivo e recarregue a extensão em `chrome://extensions`.

## Para desenvolvedores

- Lógica pura testada: `lib/agenda.js` (horário, limites, intervalo, pausa, histórico) e `lib/crm-api.js` (fila e retorno). Testes: `node --test tests/*.test.js` (nesta pasta).
- CRM: rotas `GET /api/marketplace/queue/next` e `POST /api/marketplace/queue/<id>/result`, chave no header `Authorization: Bearer mkp_...`. A extensão recebe só os campos do anúncio.
