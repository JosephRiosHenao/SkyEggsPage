# Sky Eggs: página estática servida con nginx
FROM nginx:1.27-alpine

# URL pública del sitio, sin barra final (canonical, Open Graph, sitemap).
ARG SITE_URL=https://skyeggs.pro

RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf \
 && mkdir -p /etc/nginx/snippets

COPY docker/nginx.conf /etc/nginx/conf.d/site.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY site/ /usr/share/nginx/html/

# __ASSET_V__ = huella del CSS/JS. Va en las URL (?v=…) para que, tras cada
# despliegue, el navegador descargue el CSS/JS nuevo aunque tenga el viejo en
# caché (CSS/JS se cachean 7 días; el HTML siempre se revalida).
RUN cd /usr/share/nginx/html \
 && ASSET_V=$(find . -type f \( -name '*.css' -o -name '*.js' \) | sort | xargs cat | md5sum | cut -c1-10) \
 && find . -type f \( -name '*.html' -o -name '*.xml' -o -name '*.txt' \) \
      -exec sed -i -e "s|__SITE_URL__|${SITE_URL%/}|g" -e "s|__ASSET_V__|${ASSET_V}|g" {} + \
 && ! grep -rl '__ASSET_V__\|__SITE_URL__' --include='*.html' . \
 && nginx -t

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
