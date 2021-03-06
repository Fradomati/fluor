const DEV = "development" !== "production"

function $(selector, root = document) {
  if (selector instanceof Node) {
    return [selector]
  }
  return root.querySelectorAll(selector)
}

function $$(selector, root = document) {
  if (selector instanceof Node) {
    return selector
  }
  return root.querySelector(selector)
}

function createFragment() {
  return document.createDocumentFragment()
}

function isFunction(object) {
  return Boolean(object && object.constructor && object.call && object.apply)
}

function isFluorScript(e) {
  return e.tagName === "SCRIPT" && e.type === "fluor"
}

function createId() {
  return Math.random().toString(36).slice(2)
}

// Inspired by https://github.com/lukeed/clsx
function classNames(...objs) {
  return objs
    .map((obj) => {
      return Array.isArray(obj)
        ? obj.map((e) => classNames(...e)).join(" ")
        : typeof obj === "string"
        ? obj
        : classNames(
            ...Object.entries(obj).reduce(
              (a, [k, v]) => (v ? a.concat(k) : a),
              []
            )
          )
    })
    .join(" ")
}

function dotPath(path, object) {
  return path.split(".").reduce((obj, current) => {
    if (DEV && !(current in obj)) {
      console.warn(`No path ${path} in ${JSON.stringify(object)}`)
    }
    return obj[current]
  }, object)
}

function makeValue(valueOrFn, previousValue, data) {
  return isFunction(valueOrFn) ? valueOrFn(previousValue, data) : valueOrFn
}

// Thanks @stimulus and alpine
function domReady() {
  return new Promise((resolve) => {
    if (document.readyState == "loading") {
      document.addEventListener("DOMContentLoaded", resolve)
    } else {
      resolve()
    }
  })
}

// Breadth-first node tree walk. Doesn't recurse into child when the callback
// fn returns false
function walk(node, fn) {
  const queue = [node]

  while (queue.length) {
    const next = queue.shift()
    if (fn(next) !== false) {
      for (const c of next.children) {
        queue.push(c)
      }
    }
  }
}

// Find the closest parent molecule for a given DOM node
function moleculeOf(node) {
  let parent = node

  while (parent) {
    if (FluorRuntime.__molecules__.has(parent)) {
      return FluorRuntime.__molecules__.get(parent)
    }
    parent = parent.parentElement
  }

  return null
}

function handleFIf(attr, element, data) {
  if (element.tagName !== "TEMPLATE") {
    if (DEV) {
      console.warn("f-if only works on <template> tags")
    }
    return
  }

  const truthValue = dotPath(attr.value, data)

  if (truthValue) {
    if (element.__f_if_items__) {
      return element.__f_if_items__.forEach((m) => m.render())
    }

    const fragment = createFragment()
    const clone = element.content.cloneNode(true)

    element.__f_if_items__ = []

    for (const child of [...clone.children]) {
      if (isFluorScript(child)) {
        if (DEV) {
          console.warn(
            "Fluor scripts can't be direct children of a f-if template"
          )
        }
        continue
      }
      element.__f_if_items__.push({ child })
      fragment.append(child)
    }

    element.parentNode.insertBefore(fragment, element.nextSibling)

    for (const ifItem of element.__f_if_items__) {
      const { child } = ifItem
      const molecule = newMolecule(child)
      ifItem.molecule = molecule
      discoverMolecules(child)
      molecule.render()
    }

    return
  }

  if (element.__f_if_items__) {
    removeMolecules(element.__f_if_items__)
    element.__f_if_items__ = null
  }
}

function handleFEach(attr, element, data) {
  if (element.tagName !== "TEMPLATE") {
    if (DEV) {
      console.warn("f-each only works on <template> tags")
    }
    return
  }

  const [iterator, source] = attr.value.split(/\s+in\s+/)
  const items = dotPath(source, data)
  const fragment = createFragment()

  // TODO: This is highly inefficient as we are removing then recreating all
  // elements from the list.
  // We should probably use a key-based strategy like most other frameworks do.
  if (element.__f_each_items__) {
    removeMolecules(element.__f_each_items__)
    element.__f_each_items__ = null
    handleFEach(attr, element, data)
  } else {
    element.__f_each_items__ = []
    for (let index = 0, l = items.length; index < l; index++) {
      const clone = element.content.cloneNode(true)
      for (const child of [...clone.children]) {
        if (isFluorScript(child)) {
          if (DEV) {
            console.warn(
              "Fluor scripts can't be direct children of a f-if template"
            )
          }
          continue
        }
        element.__f_each_items__.push({ index, child })
        fragment.append(child)
      }
    }

    element.parentNode.insertBefore(fragment, element.nextSibling)

    for (const eachItem of element.__f_each_items__) {
      const { index, child } = eachItem
      const molecule = newMolecule(child)
      molecule.setup({
        $index: index,
        [iterator]: items[index],
      })
      eachItem.molecule = molecule
      discoverMolecules(child)
      molecule.render()
    }
  }
}

function handleFBind(attr, element, data) {
  const [attrName, valuePath] = attr.value.split(":")
  const value = dotPath(valuePath, data)
  switch (value) {
    case true:
      element.setAttribute(attrName, "")
      break
    case false:
      element.removeAttribute(attrName)
      break
    default:
      element.setAttribute(attrName, value)
  }
}

function createMolecule(moleculeId, rootNode) {
  const data = {}
  const merge = (obj) => Object.assign(data, obj)

  const parent = rootNode ? moleculeOf(rootNode.parentNode) : null
  if (parent) {
    merge({ $parent: parent.$data })
  }

  function render(updateChildren = true) {
    const mRoot = moleculeOf(rootNode)

    walk(rootNode, (element) => {
      // Do not recurse into the element if it's from another molecule
      const mElement = moleculeOf(element)
      if (mElement !== mRoot) {
        if (updateChildren) {
          mElement.render(updateChildren)
        }
        return false
      }

      for (const attr of element.attributes) {
        switch (attr.name) {
          case "f-text":
            element.textContent = dotPath(attr.value, data)
            break
          case "f-html":
            element.innerHTML = dotPath(attr.value, data)
            break
          case "f-if":
            handleFIf(attr, element, data)
            break
          case "f-each":
            handleFEach(attr, element, data)
            break
          case "f-bind":
            handleFBind(attr, element, data)
            break
        }
      }
    })
  }

  function _set(objectOrKey, valueOrFn) {
    if (typeof objectOrKey === "object") {
      merge(
        Object.entries(objectOrKey).reduce(
          (a, [k, v]) => ({
            ...a,
            [k]: makeValue(v, data[k], data),
          }),
          {}
        )
      )
    } else {
      merge({ [objectOrKey]: makeValue(valueOrFn, data[objectOrKey], data) })
    }
  }

  function classListMutation(mutation, className, selector = null) {
    return (ev) => {
      const targets = selector ? $(selector, rootNode) : [ev.currentTarget]
      targets.forEach((target) => target.classList[mutation](className))
    }
  }

  function listOperation(method) {
    return (name, valueOrFn = null) => () => {
      data[name][method](makeValue(valueOrFn, data[name], data))
      render()
    }
  }

  const api = {
    set(objectOrKey, valueOrFn) {
      return () => {
        _set(objectOrKey, valueOrFn)
        render()
      }
    },

    toggle(variable) {
      return () => {
        _set(variable, (v) => !v)
        render()
      }
    },

    setup(objectOrKey, valueOrFn) {
      _set(objectOrKey, valueOrFn)
    },

    on(event, selector, fnOrArray) {
      const handler = Array.isArray(fnOrArray)
        ? (ev) => fnOrArray.forEach((fn) => fn(ev))
        : fnOrArray
      for (const node of $(selector, rootNode)) {
        if (moleculeOf(node).$root === rootNode) {
          node.addEventListener(event, handler)
        }
      }
    },

    addClass(className, selector = null) {
      return classListMutation("add", className, selector)
    },
    removeClass(className, selector = null) {
      return classListMutation("remove", className, selector)
    },
    toggleClass(className, selector = null) {
      return classListMutation("toggle", className, selector)
    },

    append: listOperation("push"),
    prepend: listOperation("unshift"),
    pop: listOperation("pop"),
    shift: listOperation("shift"),

    withEvent(fn) {
      return (ev) => fn(ev)()
    },

    render,

    classes: classNames,

    $data: data,
    $id: moleculeId,
    $root: rootNode,
    $parent: parent,
    $: (selector, root = rootNode) => $(selector, root),
    $$: (selector, root = rootNode) => $$(selector, root),

    __scripts__: [],
  }

  return api
}

// Initialize a new molecule with a random ID and register it to the runtime
function newMolecule(rootNode) {
  const id = createId()
  const molecule = createMolecule(id, rootNode)
  FluorRuntime.__molecules__.set(rootNode, molecule)

  return molecule
}

function destroyMolecule(molecule) {
  for (const script of molecule.__scripts__) {
    script.parentNode.removeChild(script)
  }
}

function removeMolecules(moleculeList) {
  const molecules = [...new Set(moleculeList.map((e) => e.molecule))]
  for (const m of molecules) {
    if (m.$root.parentNode) {
      m.$root.parentNode.removeChild(m.$root)
    }
    destroyMolecule(m)
  }
}

const PUBLIC_API = Object.keys(createMolecule()).filter(
  (m) => !m.startsWith("__")
)

function FluorRuntime(id, atomCode) {
  const molecule = Array.from(FluorRuntime.__molecules__.values()).find(
    (m) => m.$id === id
  )
  atomCode(molecule)
  molecule.render(false)
}

window.RunFluor = FluorRuntime

FluorRuntime.__molecules__ = new Map()

function discoverMolecules(root) {
  const atoms = []

  walk(root, (e) => {
    if (isFluorScript(e)) {
      atoms.push(e)
    }
  })

  for (const atom of atoms) {
    const rootNode = atom.parentNode
    const molecule =
      FluorRuntime.__molecules__.get(rootNode) || newMolecule(rootNode)
    atom.__f_molecule__ = molecule
  }

  const fragment = createFragment()
  for (const atom of atoms) {
    const molecule = atom.__f_molecule__
    const scriptElement = document.createElement("script")
    const wrappedScript = `RunFluor("${molecule.$id}", ({${PUBLIC_API.join(
      ","
    )}}) => {${atom.textContent}})`
    scriptElement.textContent = wrappedScript
    atom.parentNode.removeChild(atom)
    molecule.__scripts__.push(scriptElement)
    fragment.appendChild(scriptElement)
  }
  document.body.appendChild(fragment)
}

async function autostart() {
  await domReady()
  discoverMolecules(document.body)
}
autostart()

export default function Fluor(selectorOrNode, atomCode) {
  const rootNode = $$(selectorOrNode)
  const molecule = newMolecule(rootNode)
  FluorRuntime(molecule.$id, atomCode)
}
