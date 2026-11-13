# Macros

A file `<name>.mul` here is a reusable snippet. Call it with `use <name> arg1 arg2`; inside, `$1`, `$2` are the args.

```
# mul/macros/open-settings.mul
click #nav-settings
click tab:"$1" => expect tab:"$1" visible
```

```
use open-settings "Billing"
```
