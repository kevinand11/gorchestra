# Archive Period history for archivable records

Archivable Core records store Archive Period history instead of a nullable archived stamp. Archiving opens a period, unarchiving closes the latest open period, and current archived state is derived from that history so Core preserves both archive and unarchive transitions without modeling non-Delivery archival as Delivery Actions.
