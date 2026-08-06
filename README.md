# Baixo K

Sistema do Baixo K: cardapio digital, comanda de mesa por QR code, fila de pedidos,
painel de cozinha, estoque, promocoes e impressao termica 80mm.

## Como rodar

```
node server.js
```

Abre em `http://localhost:8000`. O servidor nao tem dependencia nenhuma: precisa so
do Node instalado.

- `index.html` - cardapio e carrinho do cliente (aberto)
- `admin.html` - painel: pedidos, cozinha (KDS), mesas, produtos, promocoes, estoque, dashboard (pede senha)
- `telao.html` - telao de senhas do salao (pede senha)
- `entrar.html` - tela de senha do balcao

### Supabase

Se quiser usar o banco no Supabase em vez do arquivo local, rode o SQL e inicie o
servidor com estas variaveis no ambiente:

```
SUPABASE_URL=https://<seu-projeto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<sua-chave-de-servidor>
```

O frontend nao recebe nenhuma dessas chaves.

Se preferir, coloque essas variaveis em `.env.local` na raiz do projeto. O
`server.js` carrega esse arquivo automaticamente na inicializacao.

## Senha do balcao

Na primeira execucao o servidor sorteia uma senha, guarda em `data/senha.txt` e mostra
no terminal. Para definir a sua:

```
BAIXOK_SENHA=suasenha node server.js
```

O login vale por 30 dias por aparelho, entao o tablet da cozinha e o telao pedem a
senha uma vez so. O cardapio do cliente nunca pede nada.

## Os dois modos

O site funciona de duas formas, e ele descobre sozinho em qual esta:

**Com o `server.js` no ar** - o estado fica no servidor e todos os aparelhos veem a
mesma coisa. O celular do cliente manda pedido e ele aparece na hora no tablet da
cozinha, sem ninguem recarregar nada. E o modo necessario para o salao funcionar.

**Sem o servidor** (abrindo os arquivos direto ou publicando no GitHub Pages) - cada
navegador guarda a sua propria copia no `localStorage`. Serve para demonstrar o
sistema num aparelho so, mas os aparelhos nao se enxergam.

O estado compartilhado fica em `data/baixo-k.json`, criado na primeira execucao. Esse
arquivo e o banco de dados. Na primeira vez que subir, o servidor comeca vazio e
importa o que ja existia no navegador que abrir primeiro.

### Backup

A gravacao e atomica: o servidor escreve num arquivo temporario e renomeia, entao uma
queda de energia no meio da escrita nao deixa o arquivo pela metade.

Alem disso, uma copia por dia vai para `data/backups/`, mantendo os ultimos 14 dias.
Se o arquivo principal aparecer ilegivel na hora de subir, o servidor avisa no
terminal, restaura do backup mais recente e reescreve o principal na hora.

Esse backup vive no mesmo disco: protege contra arquivo corrompido, **nao** contra o
computador queimar. Para isso, copie a pasta `data/` para outro lugar de tempos em
tempos.

## Comanda de mesa por QR code

Cada mesa tem um QR code fixo que aponta para `.../index.html?mesa=N`. O fluxo:

1. Atendente abre a mesa na aba **Mesas**. So entao o QR aceita pedidos.
2. Cliente le o QR e cai no cardapio ja identificado naquela mesa.
3. Cada pedido enviado vai para a fila da cozinha e soma na comanda da mesa.
4. Atendente fecha a conta, a nota sai no balcao e o QR trava ate a proxima abertura.

O QR e gerado na aba Mesas, botao **QR** no card. Ele aponta para o endereco publicado
em `MENU_URL` (em `app.js`) - se publicar em outro endereco, ajuste essa constante
antes de imprimir os codigos.

## Area de entrega

### Onde fica a loja

Aba **Area de entrega** no painel. Marcar o ponto **nao precisa da Mapbox** — ha tres
caminhos, e os dois primeiros funcionam sem conta em lugar nenhum:

- **"Estou na loja agora"** — usa o GPS do aparelho. Exige `https` ou `localhost`:
  rodando na rede interna por `http://192.168.x.x` o navegador recusa sem perguntar.
- **Colar a coordenada** — no Google Maps, clique com o botao direito no ponto da loja
  e escolha a primeira opcao do menu; ele copia `-22.8975, -43.1875`. Se as duas vierem
  trocadas, o sistema percebe e corrige.
- **Buscar pelo endereco** — so aparece com a Mapbox configurada.

As faixas de raio ficam guardadas com ou sem token, mas **so entram na conta com a
Mapbox ligada**: transformar o endereco do cliente em coordenada e o que precisa da API.

### Busca de endereco (Mapbox)

Opcional. Sem configurar, a entrega continua funcionando com endereco digitado
livremente e sem taxa automatica — foi assim que o sistema sempre funcionou.

1. Crie a conta em `account.mapbox.com`.
2. Copie o **Default public token**, o que comeca com `pk.`.
3. Guarde em `MAPBOX_TOKEN`, no `.env.local` (fora do git).
4. Reinicie o servidor e abra a aba **Area de entrega** no painel.
5. Busque o endereco da loja e crie as faixas de raio.

### O que a API real ensinou

Coisas medidas contra a Mapbox de verdade, com enderecos do Rio. Ficam aqui porque
nenhuma delas aparece lendo so a documentacao.

**As duas APIs tem vocabularios diferentes e cada uma recusa o tipo da outra com 422.**
O widget do navegador roda na **v5**, o servidor na **v6**. `street` so existe na v6;
`poi` so existe na v5. O widget usa a intersecao, `address,postcode,place,neighborhood`
— precisa valer nos dois lados, senao o cliente escolhe um endereco que o servidor nao
consegue reencontrar na hora de fechar o pedido.

**Ponto de referencia nao funciona.** "Museu do Amanha" fica a 600 m da loja e a v6 nao
o encontra: POI mudou para a Search Box API, que e outro endpoint. Na v6 a busca casa
com a rua de nome mais parecido.

**`proximity` sozinho nao segura.** Ele e so uma inclinacao, e a Mapbox a despreza
quando o texto casa melhor em outra cidade. "Rua Barao de Tefe, 75" — que existe na
Saude, a 500 m daqui — voltava a de **Sao Paulo** em primeiro, e a taxa dava 363 km: o
pedido era recusado por um endereco que o entregador faz a pe. O `bbox` em volta da
area resolveu, e passou a dar 0,1 km.

**A Mapbox nao conhece CEP brasileiro completo.** `20081-262`, `20220-460`, `22010-000`
e ate `01310-100` (Avenida Paulista) devolvem zero. Sem hifen, `20081262` casa com
Piquete, no interior de Sao Paulo. So o prefixo de 5 digitos funciona, e aponta para a
cidade inteira. Por isso o CEP passa antes pelo **ViaCEP**, o servico dos Correios, que
e gratuito e sem cadastro: ele vira rua e bairro, e ai sim a Mapbox encontra. So o CEP
sai daqui — nenhum dado do cliente vai junto. Se o ViaCEP estiver fora do ar, a busca
segue com o texto cru.

### Sobre o token

A caixa de busca e o widget oficial da Mapbox (`mapbox-gl-geocoder`), que roda no
navegador e por isso precisa do token la. Token publico existe exatamente para esse
uso: a propria Mapbox o trata como exposto, e quem protege ele e a restricao de
dominio na conta, nao o sigilo.

**Nao coloque restricao por URL** enquanto o `server.js` usar o mesmo token. Chamada
de servidor nao manda `Referer`, e a Mapbox recusaria. Se quiser restringir, gere
dois tokens: um publico restrito ao seu dominio, e um secreto so para o servidor.

Token secreto (`sk.`) nunca e entregue ao navegador. Nesse caso o widget nao aparece
e a busca volta a passar pelo `server.js` — o mesmo acontece se a CDN da Mapbox
estiver bloqueada na rede da loja. Sem token nenhum, a entrega funciona com endereco
digitado livremente e sem taxa automatica, como sempre funcionou.

O mapa da aba do painel continua passando pelo servidor em qualquer caso.

A distancia e medida **em linha reta** a partir da loja, que e o que "raio de entrega"
significa. O cliente paga a taxa da primeira faixa que alcanca; endereco alem da
ultima faixa e recusado. Cada faixa tem seu proprio pedido minimo.

Custo: o plano gratuito da Mapbox cobre 100 mil buscas de endereco por mes. Uma casa
desse porte nao chega perto disso.

**Nao guardamos coordenada de cliente.** O plano gratuito e o de geocodificacao
temporaria, que proibe armazenamento permanente dos resultados. O sistema calcula a
taxa na hora e grava so o endereco em texto, a distancia e o valor.

**A taxa mostrada no carrinho e uma previa.** Ela pode partir da coordenada que o
widget escolheu no navegador. O valor cobrado nao: ao registrar o pedido o servidor
geocodifica o endereco de novo, refaz a distancia e recusa o que estiver fora da
area. Trocar a coordenada no navegador so engana a propria tela.

## Impressora Elgin i8

A impressao sai pelo dialogo do navegador. Para usar a Elgin i8:

1. Instale o driver da Elgin i8 no Windows.
2. Configure papel 80mm.
3. Abra `admin.html`.
4. Clique em `Teste cozinha` ou `Teste balcao`.
5. Selecione a Elgin i8 no dialogo de impressao.

Impressao silenciosa direta, sem dialogo, precisa de um agente local instalado no
computador da loja.

## Estoque

O estoque baixa **no aceite do pedido**, nao na entrega. E o que faz o cardapio dizer
a verdade: reservado o item, ele some da vitrine quando acaba, e o proximo cliente nao
consegue pedir o que a casa nao tem. Recusar um pedido devolve os itens.

## O que o servidor nao aceita do cliente

O navegador do cliente e tratado como nao confiavel. Ao receber um pedido, o servidor
refaz tudo pelo proprio cadastro: preco do produto, preco promocional, desconto de
cupom, taxa de entrega e total. Tambem recusa item pausado, quantidade acima do
estoque, endereco fora da area e pedido em mesa que nao esteja aberta. O que o cliente
manda so diz *o que* foi pedido.

A lista de pedidos nunca vai para quem nao tem sessao: ela carrega nome, telefone e
endereco de todo mundo que pediu no dia.

Nada da pasta `data/` e servido pela web — nem o banco, nem a senha, nem o token. O
servidor tambem so entrega arquivos com extensao do proprio site, e `server.js`,
`package.json` e qualquer arquivo comecando com ponto ficam de fora.

A senha aceita 10 tentativas a cada 15 minutos por IP, e a sessao expira em 30 dias no
servidor — nao so no navegador.

> **Atras de um proxy com TLS, rode com `CONFIAR_PROXY=1`.** Sem isso todo mundo chega
> com o IP do proxy e um cliente errando a senha trava a loja inteira. Com a variavel
> ligada o servidor usa o IP real que o proxy anuncia em `X-Forwarded-For`. Nao ligue a
> variavel sem proxy na frente: quem chama direto escreve o que quiser nesse cabecalho.

## Limitacoes conhecidas

- **Publicar em host estatico nao protege o painel.** A senha e verificada no
  servidor. Se voce subir esses arquivos no GitHub Pages, `admin.html` fica aberto a
  qualquer um, porque la nao ha servidor para exigir nada. Publique estatico so como
  demonstracao; para a loja usar, rode o `server.js`.
- **Uma senha so, sem usuarios.** Nao ha login por pessoa nem registro de quem fez o
  que.
- **Sem HTTPS.** Rodando na rede local da loja tudo bem. Exposto na internet, coloque
  atras de um proxy com TLS.
- **Cupom "uso unico por cliente" nao e aplicado.** O sistema guarda e mostra a marca,
  mas sem cadastro de cliente nao ha como saber quem ja usou.
- **Escrita simultanea.** O servidor mescla pedidos e mesas por chave, entao um
  aparelho atrasado nao apaga o que outro criou. Ja produtos, promocoes e cupons sao
  substituidos inteiros: se duas pessoas editarem o cardapio ao mesmo tempo, vale a
  ultima gravacao.
