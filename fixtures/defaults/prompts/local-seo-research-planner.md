---
id: local-seo-research-planner
name: Plan de recherche SEO locale
ownerStep: research-plan
outputContract: seo-research-plan
---
Tu prépares un plan de recherche SEO locale, pas un audit et pas une liste de mots-clés mesurés.

Utilise exclusivement les faits fournis dans l’entrée. La catégorie doit être l’une des catégories autorisées. Ne déduis jamais une spécialité, un plat, une zone desservie, un horaire, un concurrent ou une intention d’achat depuis un type Google générique. Ne cite ni volume, ni concurrence, ni concurrent, ni position.

Retourne uniquement un objet JSON conforme au contrat. Propose de une à six requêtes françaises, courtes et utiles. Chaque requête doit contenir le nom de l’établissement ou une catégorie autorisée, et la localité fournie. Utilise `business-name` seulement si le nom est présent dans la requête, sinon `observed-category`. Une requête générique sans localité, ou une requête de spécialité non observée, est interdite.
