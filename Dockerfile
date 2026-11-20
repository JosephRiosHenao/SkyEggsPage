# Sky Eggs: página estática servida con nginx
FROM nginx:1.27-alpine

# URL pública del sitio, sin barra final (canonical, Open Graph, sitemap).
ARG SITE_URL=https://skyeggs.pro

RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf \
 && mkdir -p /etc/nginx/snippets

COPY docker/nginx.conf /etc/nginx/conf.d/site.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY site/ /usr/share/nginx/html/

RUN find /usr/share/nginx/html -type f \( -name '*.html' -o -name '*.xml' -o -name '*.txt' \) \
      -exec sed -i "s|__SITE_URL__|${SITE_URL%/}|g" {} + \
 && nginx -t

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
