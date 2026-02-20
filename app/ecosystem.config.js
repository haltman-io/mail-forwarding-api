const path = require('path');

module.exports = {
    apps: [
        {
            name: "mail-forwarding-api",        // nome do processo (tem que explicar???????????????)
            script: "./src/server.js",          // ENTRYPOINT DESSE CARALHO
            cwd: ".",                           // GARANTE QUE A PORRA DO DIRETÓRIO ATUAL É O RAÍZ DA APLICAÇÃO

            instances: 1,                       // pra que mais de 1?
            exec_mode: "fork",                  // foi mal, não tamo pronto pra rodar essa porra aq em cluster ainda caraio, vai gerar race condition em tudo que é tipo de workflow

            autorestart: true,                  // HABILITANDO AUTORESTART (NÃO AGUENTO MAIS ENTRAR NO HOST E INICIAR O PROCESSO VIA screen -dmS)
            watch: false,                       // ambiente de dev = ok, esse ambiente aqui = dá não slc
            max_memory_restart: "400M",         // SE PASSAR DE 400MB DE RAM, RESTARTA O PROCESSO (hj é sem memleak)

            out_file: path.join(__dirname, 'logs', 'out.log'),      // sa poha fica caindo e n tem como saber pq n tem log esse caraio
            error_file: path.join(__dirname, 'logs', 'error.log'),  // que DEUS me perdoe por esse tanto de merda q eu escrevi, papo reto
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",


            env_production: {
                NODE_ENV: "production",
            },
        }
    ]
}; ''