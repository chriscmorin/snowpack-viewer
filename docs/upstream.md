# Upstream attribution

## Scientific references

- [niViz](https://niviz.org/), licensed under [AGPL-3.0-or-later](NIVIZ-AGPL-3.0.txt), provides the reference behavior for PRO parsing, grain classifications, hardness conversions, and display axes. Its JavaScript is not bundled with this viewer. The reference [deployed application](https://run.niviz.org/assets/application-4ee62e1ce3456a8446645bbf5f9e7690.js) was retrieved on 2026-09-24 with SHA-256 `62008f28ffe46b5048a65b1407df17fbc9780fa8bd1667ebc5c72d0c3a0ae602`; no niViz source commit is claimed. Public documentation covers [PRO parsing](https://niviz.org/niviz/dist/doc/files/lib_parsers_pro.js.html), [grain shapes](https://niviz.org/niviz/dist/doc/files/lib_values_grainshape.js.html), and [hardness](https://niviz.org/niviz/dist/doc/files/lib_values_hardness.js.html).
- [SNOWPACK](https://git.wsl.ch/snow-models/snowpack) documents the [PRO format](https://git-pages.wsl.ch/snow-models/snowpack-web/doc-release/html/pro_format.html). Source examples use commit `95551b6dfbb0a8e2d3df81c77ea4567a293116c5`. Its [LGPL license](SNOWPACK-LICENSE.txt) and incorporated [GPL text](SNOWPACK-GPL-3.0.txt) are included.
- Grain symbols are independently drawn using the [IACS symbol documentation](https://cryosphericsciences.org/wp-content/uploads/2019/02/SnowSymbolsIACS_docu.pdf). SnowSymbolsIACS font files are not bundled.

## Example data

| File | Source | SHA-256 |
| --- | --- | --- |
| `niviz-example.pro` | [niViz example](https://niviz.org/resources/example.pro); 48 evolving profiles | `bcb5f364e9df35d4c3352271510c8b8ef830ee8ebf28a00d1414b5d3895b921d` |
| `snowpack-albedo-WFJ2.pro` | `tests/albedo/output/WFJ2_res.pro` in the pinned SNOWPACK commit; 2,225 snow-free profiles | `2a2c31c81ecc3713c9c82153e2431b551c692338edc6180d1d93280f488820d2` |
| `snowpack-soil-gems.pro` | SNOWPACK 3.7.0 run of its bundled Gemsstock soil example; 25 profiles | `554fb9cbf130a4fcd437bc6accc74f773ce1f045f6587ff105717b61045bbe6e` |
| `snowpack-large-MST96.pro` | SNOWPACK 3.7.0 bundled output `share/doc/snowpack/examples/output/MST96_oper.497.1220.EtSDt.pro`; 1,832 profiles | `0fa1c925b4f9c2da16098715923211e4d3d857b10098548946c9bda685f6956a` |

The niViz site identifies its content license as [CC BY 4.0](NIVIZ-SITE-CC-BY-4.0.txt); its example is used as a test fixture. The hosted demo offers the full SNOWPACK MST96 example as a separate compressed file. The standalone HTML contains no example data. SNOWPACK data retain their upstream attribution and license texts. The inspected SNOWPACK example files do not state a separate data license; the project maintainer confirmed permission to redistribute the example data on 2026-09-24. This does not relicense the datasets under the viewer's AGPL license.

In the source repository, `python3 scripts/generate-fixtures.py` reacquires the fixtures and repeats the soil run. It requires network access and the SNOWPACK 3.7.0 example installation. Use `--output` for a separate fixture directory. The soil run uses bundled `gems.smet`, `gems.sno`, and `io_soil.ini` with `snowpack -c io_soil.ini -e 2010-10-03T01:00`.
