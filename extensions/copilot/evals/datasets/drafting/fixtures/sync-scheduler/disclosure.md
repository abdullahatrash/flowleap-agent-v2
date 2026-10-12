# Invention disclosure: battery- and network-aware data synchronisation

Invented matter for the drafting regression eval. Not a real invention.

## §1 Field

The invention relates to scheduling background data synchronisation on a mobile device.

## §2 Background

Known apps start a synchronisation job as soon as data changes. On a low battery this drains
the battery, and on a cellular network it uses metered data.

## §3 Description

§3.1 The mobile device 100 runs a scheduler 106. A battery monitor 102 reports the battery
level of the mobile device 100 to the scheduler 106.

§3.2 A network detector 104 reports the network type to the scheduler 106: unmetered (for
example Wi-Fi) or metered (for example a cellular network).

§3.3 The scheduler 106 starts a synchronisation job only when the battery level is above a
threshold and the network type is unmetered. In the preferred embodiment the threshold is
30 percent of a full charge.

§3.4 When the network type is metered, the scheduler 106 places the synchronisation job in a
job queue 108. The scheduler 106 starts the queued job when the network detector 104 reports
an unmetered network.

## §4 Examples

§4.1 Example 1 (we ran it): on a test phone over one week, the scheduler reduced the failed
synchronisation jobs to about one quarter of the number we saw with immediate synchronisation.

§4.2 Example 2 (not yet run): we expect that the same scheduler on a tablet will extend the
time between charges, because a tablet also synchronises in the background.
