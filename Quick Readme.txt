

Services to Run:

1. MQTT Broker - NanoMQ: nanomq-0.24.13-windows-x86_65 > bin > run-nanomq.bat. Will start MQTT broker (I dont remember the configuration now)

2. Server: Choose either one
   a) start-server.bat  =  Vanilla JS version. Launch server at port 9117. Access through localhost:9117
   b) start-reactserver.bat = React JS Typescript version (migrated from Vanilla JS). Access through localhost:9117
   
3. VPN - Use Tailscale
   a) Install Tailscale. Login. Enable Tailscale tunneling at their website
   b) Then CMD and use command Tailscale Serve 9117. It will allow the webapp to be hosted on https://<your-link>.ts 
   c) Client device has to be in the same tailnet. Install Tailscale on other device, login with same account. THen access the webapp using https://<your-link>.ts 
   
   
   After done, can access the webapp using localhost:9117. It will automatically try to connect to the MQTT broker.
   If the Base Station is also connected, it will also try to connect to the MQTT broker.
   