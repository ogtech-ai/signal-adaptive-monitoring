# UCI 235 attribution

Georges Hebrail and Alice Berard (2006). Individual Household Electric Power Consumption. UCI Machine Learning Repository. DOI: https://doi.org/10.24432/C58K54

Official source: https://archive.ics.uci.edu/dataset/235/individual+household+electric+power+consumption

License: Creative Commons Attribution 4.0 International (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/

Modifications: chronological first 1440 one-minute rows; select Global_active_power (kW), Voltage (V), Global_intensity (A); convert missing values to JSON null; retain original local timestamps without inferring a timezone. No fault labels are provided. This is household electricity data, not industrial bearing measurements or recorder data. It must not be described as all healthy. Background alerts have unknown fault status.

Archive SHA256: `9f84b46ade8a2d8e1286ec4b2b6c2987a45a755c59f263be3b3b3d10dfbda3ff`

The app's synthetic signals are generated with NumPy, seed 520. Injected spikes/drifts/missing values are synthetic modifications and clearly labeled. The source archive is cached locally and excluded from Git. No customer datasets are distributed.
