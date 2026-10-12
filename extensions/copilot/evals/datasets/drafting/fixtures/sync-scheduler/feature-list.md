---
office: US
confirmed: true
---
# Feature List

| ID | Feature | Source |
| --- | --- | --- |
| F1 | A scheduler 106 on a mobile device 100 schedules background data synchronisation. | disclosure:§3.1 |
| F2 | A battery monitor 102 reports the battery level of the mobile device 100 to the scheduler 106. | disclosure:§3.1 |
| F3 | A network detector 104 reports the network type: unmetered (for example Wi-Fi) or metered (for example a cellular network). | disclosure:§3.2 |
| F4 | The scheduler 106 starts a synchronisation job only when the battery level is above a threshold and the network type is unmetered; preferred threshold 30 percent of a full charge. | disclosure:§3.3 |
| F5 | On a metered network the scheduler 106 places the job in a job queue 108 and starts it when an unmetered network is reported. | disclosure:§3.4 |
| F6 | Working example: on a test phone over one week, failed synchronisation jobs fell to about one quarter of the number with immediate synchronisation. | disclosure:§4.1 |
| F7 | Prophetic example: the same scheduler on a tablet is expected to extend the time between charges. | disclosure:§4.2 |
