---
layout: default
title: Green Tea Documentation
---

{% capture docs %}{% include_relative docs.md %}{% endcapture %}
{{ docs | markdownify }}
