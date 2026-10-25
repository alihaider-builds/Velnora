// jsdom does not implement layout APIs; stub the ones components call.
Element.prototype.scrollIntoView = function scrollIntoView() {}
