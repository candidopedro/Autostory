# Autostory tool v1.0

Cole o link de um produto do **Mercado Livre, OLX, Shopee ou Amazon** e o Autostory monta um story (1080×1920) e posta no Instagram usando um fluxo do **n8n**.

## Como funciona

1. **Background**: o fundo padrão é **Cor do produto**: o Autostory detecta a cor de destaque da foto extraída (ignorando o fundo branco e tons de cinza) e cria um degradê com ela. Também dá para escolher um fundo pronto no menu ou enviar uma imagem do dispositivo com o botão ao lado. A imagem enviada fica salva no navegador e passa a ter prioridade nas próximas postagens. O botão **Excluir** apaga a imagem e volta para a cor do produto.
2. **Link**: cole a URL e as fotos e o preço do produto são lidos do HTML da página. Toque nas fotos para escolher quais usar. Com mais de uma foto selecionada, escolha entre **Colagem** e **Vários stories**. Se a extração falhar, use **Adicionar fotos do dispositivo**.
3. **Preço em destaque**: escolha o que aparece no lugar do preço: **Preço** (o preço extraído, que dá para editar, mais o preço antigo riscado, se houver), **Outro texto** (PROMOÇÃO, 12x sem juros, Desconto no Pix… ou o que quiser) ou **Ocultar**. A **condição de pagamento** é opcional e tem sugestões rápidas (12x sem juros, 10% off no Pix, Frete grátis…), que calculam a parcela e o valor no Pix a partir do preço e ficam lembradas para as próximas postagens.
4. **Preview**: sempre no formato 9:16, em qualquer tela. Em **Editar disposição**, arraste as fotos, o painel de preço e o texto do topo direto no preview. Os botões aumentam, diminuem, ocultam ou restauram os elementos, e guias mostram as áreas cobertas pela interface do Instagram. A disposição fica salva para as próximas postagens. **Gerar novamente** troca o estilo (cartão, polaroid ou foto inteira) e a organização da colagem. **Postar** pede o login no Instagram, se você ainda não entrou, e envia as imagens para o n8n publicar.

Outros detalhes:
- O tema claro ou escuro segue o do dispositivo.
- O layout se adapta a desktop e celular.
- O site pode ser instalado como app (PWA): use o botão **Instalar app** ou o menu do Chrome em "Instalar Autostory".
- No Android, depois de instalado, o Autostory aparece na opção **Compartilhar** dos apps das lojas.

## Estrutura

```
server/index.js      API: extração, proxy de imagens, login Instagram, envio ao n8n
server/extract.js    extratores por loja (Mercado Livre, OLX, Shopee, Amazon) + Open Graph/JSON-LD
server/sessions.js   sessões (cookie httpOnly, salvas em data/sessions.json)
public/              site (HTML/CSS/JS puros), manifest e service worker
n8n/autostory-workflow.json   fluxo pronto para importar no n8n
```

## Rodando

Requer Node.js 20.12 ou mais recente.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm start
```

O site abre em http://localhost:3000.

Para testar sem uma conta da Meta, defina `DEV_FAKE_LOGIN=1` no `.env`. Isso cria um login falso. Para a postagem chegar ao n8n, o `N8N_WEBHOOK_URL` ainda precisa estar configurado.

## Configuração

### 1. App da Meta (login com Instagram)

1. Em https://developers.facebook.com crie um app e adicione o produto **Instagram → API do Instagram com login do Instagram**.
2. Em *Configurar login de empresa do Instagram*, cadastre a URL de redirecionamento: `https://SEU_DOMINIO/auth/instagram/callback`.
3. Copie o **ID do app do Instagram** e a **chave secreta** para `IG_APP_ID` e `IG_APP_SECRET`.
4. Permissões usadas: `instagram_business_basic` e `instagram_business_content_publish`.
5. Para outras pessoas usarem o app, ele precisa passar pela análise da Meta (App Review). Enquanto isso, adicione as contas como testadoras.

> A API oficial só publica em contas **profissionais** (Comercial ou Criador de conteúdo). Contas pessoais não funcionam.

### 2. n8n

1. No n8n, use **Import from file** e escolha `n8n/autostory-workflow.json`.
2. (Opcional) No nó **Validar e separar imagens**, preencha `SECRET` com o mesmo valor de `N8N_WEBHOOK_SECRET`.
3. Ative o fluxo e copie a **Production URL** do nó Webhook para `N8N_WEBHOOK_URL`.

O fluxo recebe:

```json
{
  "type": "instagram_story",
  "images": ["https://SEU_DOMINIO/generated/....jpg"],
  "product": { "url": "...", "title": "..." },
  "instagram": { "userId": "...", "username": "...", "accessToken": "..." }
}
```

Em seguida, para cada imagem, o fluxo chama `POST /{ig-user-id}/media` com `media_type=STORIES`, espera e chama `POST /{ig-user-id}/media_publish`. Os stories são publicados na ordem da prévia. No fim, o fluxo responde `{ "ok": true, "posted": N }`.

### 3. Publicação do site

- `PUBLIC_BASE_URL` precisa ser uma URL **HTTPS pública**, porque o Instagram baixa as imagens geradas por essa URL. HTTPS também é exigido para instalar o PWA.
- As imagens enviadas ficam em `generated/` e são apagadas depois de 24 horas.
- Qualquer serviço que rode Node serve: VPS com Nginx, Render, Railway, Fly.io etc. Mantenha `data/` em disco persistente para os logins sobreviverem a reinícios.

## Observações sobre a extração

Onde cada loja guarda as fotos no HTML:

| Loja | Fotos | Preço |
|---|---|---|
| Mercado Livre | `img.ui-pdp-image.ui-pdp-gallery__figure__image` (convertidas para alta resolução) | `.ui-pdp-price__second-line` (preço antigo: `.ui-pdp-price__original-value`) |
| OLX | `.advc-gallery__image-wrap` (a maior versão de cada foto; miniaturas `/thumbsLxA/` viram o original `/images/`) | `#price-box-container` |
| Amazon | `.imgTagWrapper` (+ demais fotos do bloco `colorImages`) | `.priceToPay .a-offscreen` (preço antigo: `.basisPrice`) |
| Shopee | `.i9ihcI` | JSON da página (`price` / `price_before_discount`) |

Se o seletor não encontrar nada, o extrator usa os planos B abaixo.

- As lojas mudam o HTML com frequência e às vezes bloqueiam acessos automáticos. Por isso cada extrator tem plano B: Open Graph, JSON-LD e uma segunda tentativa como robô de preview de links.
- A **Shopee** monta a página quase toda por JavaScript e troca os nomes de classe (como `i9ihcI`) a cada atualização do site. O HTML que o servidor recebe muitas vezes não traz a galeria, então às vezes só a imagem principal vem. Para essas situações existe **Adicionar fotos do dispositivo**.
- Links curtos (`amzn.to`, `meli.la`, `s.shopee.com.br`) são seguidos automaticamente.
